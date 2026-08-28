# =============================================================================
# Test: punti di ripristino da 1 Completo + 2 Differenziali + 2 Log transazioni
# -----------------------------------------------------------------------------
# Crea un database usa-e-getta con recovery FULL, esegue la catena di backup
#   1) Completo (FULL)        2) Differenziale  3) Differenziale
#   4) Log transazioni        5) Log transazioni
# con INSERT a momenti distinti tra un backup e l'altro, poi legge il file con
# RESTORE HEADERONLY e verifica che l'app restituisca TUTTI i punti/momenti
# ripristinabili (5), ognuno con la catena necessaria (Completo → Diff → Log).
# Infine prova il ripristino "al punto nel tempo" sul 5° punto (catena completa).
#
# Prerequisiti: backend attivo su http://localhost:5213, connessione salvata
# id 2 (sql2019dev/WSGSDMALTA). PULISCE TUTTO alla fine.
# =============================================================================
$ErrorActionPreference = 'Stop'
$api = 'http://localhost:5213/api'
$fail = 0

function Check($name, $cond, $detail = '') {
  if ($cond) { Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name  $detail" -ForegroundColor Red }
}

Write-Host '== Connessione al server di test ==' -ForegroundColor Cyan
$conn = Invoke-RestMethod -Method Post -Uri "$api/connections/saved/2/connect" -ContentType 'application/json' -Body '{}' -TimeoutSec 30
$cid = $conn.connectionId
Write-Host "  connectionId=$cid db=$($conn.database)"

$db = '__tst_rp'
$dir = 'C:\Temp\restore_points_test'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir 'chain.bak'

function Exec($sql) {
  $r = Invoke-RestMethod -Method Post -Uri "$api/query/$cid/execute" -ContentType 'application/json' -Body (@{ sql = $sql } | ConvertTo-Json) -TimeoutSec 300
  if ($r.error) { throw "SQL ERROR: $($r.error)" }
  return $r
}
function Backup($type, $name) {
  $req = @{ path = $file; type = $type; component = 'database'; database = $db; name = $name; overwriteMode = if ($name -eq 'FULL') { 'format' } else { 'append' } } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri "$api/db/$cid/backup" -ContentType 'application/json' -Body $req -TimeoutSec 300
  # con FireInfoMessageEventOnUserErrors gli errori del dispositivo arrivano nei messages
  $msg = ($r.messages -join ' ')
  if ($r.error -or $msg -match 'Non è possibile aprire|Interruzione anomala') {
    throw "BACKUP ERROR ($name): $($r.error)$msg"
  }
  return $r
}

try {
  Write-Host '== Setup database di test ==' -ForegroundColor Cyan
  Exec "IF DB_ID('$db') IS NULL CREATE DATABASE $db;"
  Exec "ALTER DATABASE $db SET RECOVERY FULL;"
  Exec "USE $db; IF OBJECT_ID('dbo.ev') IS NULL CREATE TABLE dbo.ev (id INT PRIMARY KEY, val NVARCHAR(60), mom datetime2); DELETE FROM dbo.ev; USE master;"

  Write-Host '== Catena di backup: Completo + 2 Differenziali + 2 Log ==' -ForegroundColor Cyan
  Exec "INSERT INTO $db.dbo.ev VALUES (1, N'prima del FULL', SYSDATETIME());"
  Backup 'full' 'FULL' | Out-Null
  Write-Host '  [1/5] Completo  OK'

  Exec "INSERT INTO $db.dbo.ev VALUES (2, N'dopo FULL', SYSDATETIME()); WAITFOR DELAY '00:00:01';"
  Backup 'differential' 'DIFF1' | Out-Null
  Write-Host '  [2/5] Differenziale 1 OK'

  Exec "INSERT INTO $db.dbo.ev VALUES (3, N'dopo DIFF1', SYSDATETIME()); WAITFOR DELAY '00:00:01';"
  Backup 'differential' 'DIFF2' | Out-Null
  Write-Host '  [3/5] Differenziale 2 OK'

  Exec "INSERT INTO $db.dbo.ev VALUES (4, N'dopo DIFF2', SYSDATETIME()); WAITFOR DELAY '00:00:01';"
  Backup 'log' 'LOG1' | Out-Null
  Write-Host '  [4/5] Log 1 OK'

  Exec "INSERT INTO $db.dbo.ev VALUES (5, N'dopo LOG1', SYSDATETIME());"
  Backup 'log' 'LOG2' | Out-Null
  Write-Host '  [5/5] Log 2 OK'

  Write-Host '== Lettura dei punti di ripristino (RESTORE HEADERONLY) ==' -ForegroundColor Cyan
  $info = Invoke-RestMethod -Method Post -Uri "$api/db/$cid/backup-info" -ContentType 'application/json' -Body (@{ path = $file } | ConvertTo-Json) -TimeoutSec 120
  Check 'HEADERONLY senza errori' ($null -eq $info.error) $info.error
  Check '5 backup set trovati' ($info.sets.Count -eq 5) "trovati $($info.sets.Count)"

  $types = $info.sets | ForEach-Object { $_.type }
  Check 'Ordine tipi: 1,5,5,2,2 (Completo, Diff, Diff, Log, Log)' (($types -join ',') -eq '1,5,5,2,2') ($types -join ',')

  Write-Host '  Punti di ripristino (momento = fine backup):' -ForegroundColor Yellow
  foreach ($s in $info.sets) {
    $tipo = switch ($s.type) { 1 { 'Completo' } 5 { 'Differenziale' } 2 { 'Log transazioni' } default { "Tipo $($s.type)" } }
    Write-Host ("    Pos {0}  {1,-18}  momento {2}  DB {3}" -f $s.position, $tipo, $s.finishDate, $s.databaseName)
  }

  # Punti ripristinabili = ogni set dopo l'ultimo Completo (catena Completo → … → set)
  $restorePoints = @()
  $lastFull = -1
  for ($i = 0; $i -lt $info.sets.Count; $i++) {
    if ($info.sets[$i].type -eq 1) { $lastFull = $i }
    if ($lastFull -ge 0) { $restorePoints += ,@($info.sets[$lastFull..$i]) }
  }
  Check '5 punti di ripristino (un momento per ogni backup)' ($restorePoints.Count -eq 5) "punti=$($restorePoints.Count)"

  Write-Host '== Prova ripristino della catena fino al 5° punto (al momento del Log 2) ==' -ForegroundColor Cyan
  $dest = '__tst_rp_r'
  $moves = @(@{ logicalName = '__tst_rp'; physicalPath = (Join-Path $dir 'rp.mdf') }, @{ logicalName = '__tst_rp_log'; physicalPath = (Join-Path $dir 'rp_log.ldf') })
  $chainRestoreOk = $true
  for ($i = 0; $i -lt $info.sets.Count; $i++) {
    $s = $info.sets[$i]
    $isLog = $s.type -eq 2
    $isLast = $i -eq ($info.sets.Count - 1)
    $req = @{
      path = $file; filePosition = $s.position; databaseName = $dest; sourceDatabase = $s.databaseName
      setType = if ($isLog) { 'log' } else { 'database' }
      replace = ($i -eq 0); leaveRestoring = (-not $isLast)
      moveFiles = if (-not $isLog -and $i -eq 0) { $moves } else { $null }
    } | ConvertTo-Json -Depth 5
    $r = Invoke-RestMethod -Method Post -Uri "$api/db/$cid/restore" -ContentType 'application/json' -Body $req -TimeoutSec 300
    if ($r.error) { $chainRestoreOk = $false; Write-Host "  ERRORE catena al pos $($s.position): $($r.error)" -ForegroundColor Red; break }
    Write-Host "  [$(($i+1))/5] Pos $($s.position) (tipo $($s.type)) ripristinato"
  }
  Check 'Catena Completo→Diff→Diff→Log→Log ripristinata' $chainRestoreOk

  if ($chainRestoreOk) {
    $cnt = Exec "SELECT COUNT(*) AS n FROM $dest.dbo.ev;"
    $n = $cnt.resultSets[0].rows[0][0]
    Check 'Dopo la catena il DB contiene tutte le 5 righe' ($n -eq 5) "righe=$n"
    $ids = (Exec "SELECT id FROM $dest.dbo.ev ORDER BY id").resultSets[0].rows | ForEach-Object { $_[0] }
    Check 'Righe 1..5 presenti' (($ids -join ',') -eq '1,2,3,4,5') ($ids -join ',')
  }

  Write-Host '== Esito ==' -ForegroundColor Cyan
  if ($fail -eq 0) { Write-Host '  TUTTI I TEST SUPERATI: 5 punti di ripristino elencati e catena verificata.' -ForegroundColor Green }
  else { Write-Host "  $fail TEST FALLITI" -ForegroundColor Red }
}
finally {
  Write-Host '== Pulizia ==' -ForegroundColor Cyan
  try {
    $conn2 = Invoke-RestMethod -Method Post -Uri "$api/connections/saved/2/connect" -ContentType 'application/json' -Body '{}' -TimeoutSec 30
    Exec "IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE $db SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE $db; END; IF DB_ID('$dest') IS NOT NULL BEGIN ALTER DATABASE $dest SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE $dest; END;"
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
    Write-Host '  Pulito.' -ForegroundColor DarkGray
  } catch { Write-Host "  Pulizia parziale: $($_.Exception.Message)" -ForegroundColor DarkGray }
}
exit $fail
