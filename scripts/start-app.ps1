<#
  Avvia (o ferma) i due server di SQL Intelligence Assistant in due finestre separate:
    - BACKEND  ASP.NET Core  -> http://localhost:5213
    - APP      React + Vite  -> http://localhost:5173  (Vite inoltra /api al backend)

  Uso:
    .\scripts\start-app.ps1                 avvia backend e app e apre il browser
    .\scripts\start-app.ps1 -Diagnosi       CONTROLLA SOLO i prerequisiti e stampa un rapporto
    .\scripts\start-app.ps1 -Stop           ferma i due server
    .\scripts\start-app.ps1 -NoBrowser      avvia senza aprire il browser
    .\scripts\start-app.ps1 -SkipInstall    errore (invece di npm install) se manca node_modules
    .\scripts\start-app.ps1 -Anteprima      stampa i comandi che ESEGUIREBBE, senza eseguirli
    .\scripts\start-app.ps1 -Pausa          a fine script (anche in errore) attende un tasto: così il
                                            messaggio resta a schermo. Lo usa avvia.cmd col doppio clic.

  Se PowerShell blocca lo script per la ExecutionPolicy:
    powershell -ExecutionPolicy Bypass -File .\scripts\start-app.ps1

  In caso di problemi lancia prima `-Diagnosi`: stampa una riga per ogni prerequisito con [OK]/[--],
  il dettaglio (versione trovata) e, se manca qualcosa, il LINK o il comando per rimediare.
#>
[CmdletBinding()]
param(
  [switch]$Stop,
  [switch]$NoBrowser,
  [switch]$SkipInstall,
  [switch]$Diagnosi,
  [switch]$Anteprima,
  [switch]$Pausa,
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'

$root        = Split-Path -Parent $PSScriptRoot
$backendDir  = Join-Path $root 'backend\SqlIntelliBackend'
$frontendDir = Join-Path $root 'frontend'
$backendPort = 5213
$appPort     = 5173
$backendUrl  = "http://localhost:$backendPort"
$appUrl      = "http://localhost:$appPort"

function Write-Titolo($testo) { Write-Host "`n$testo" -ForegroundColor Cyan }
function Write-Ok($testo)     { Write-Host "  [OK] $testo" -ForegroundColor Green }
function Write-Manca($testo)  { Write-Host "  [--] $testo" -ForegroundColor Yellow }

<#
  Attende un tasto prima di chiudere la finestra SOLO con -Pausa (lo passa avvia.cmd; richiesta utente: "prima di chiudersi, se mancano dei
  prerequisiti mi deve mostrare cosa manca e poi con un tasto si può chiudere").
  Si salta da sola se l'input è rediretto (script lanciato da automazione/task), così
  non blocca mai una macchina.
#>
function Wait-Chiusura([string]$Messaggio) {
  # la pausa serve solo quando la finestra si chiuderebbe da sola (avvio da doppio clic: avvia.cmd
  # passa -Pausa). Da un terminale già aperto non c'è nulla da attendere.
  if (-not $Pausa) { return }
  try {
    if ([Console]::IsInputRedirected) { return }
    Write-Host ''
    if (-not $Messaggio) { $Messaggio = 'Premi un tasto qualsiasi per chiudere questa finestra...' }
    Write-Host "  $Messaggio" -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  } catch {
    # console senza tastiera (es. output rediretto): non c'è niente da attendere
  }
}

<#
  Esegue un programma esterno e ne restituisce l'output come TESTO.
  Serve perché con $ErrorActionPreference = 'Stop' PowerShell 5.1 trasforma QUALSIASI riga che il
  programma scrive su stderr (anche un semplice "npm notice") in un errore ROSSO: è esattamente il
  "testo rosso illeggibile" che si vedeva all'avvio. Qui l'output viene catturato e mostrato in modo
  ordinato, e i messaggi su stderr non diventano errori.
#>
function Invoke-Esterno {
  param([string]$Eseguibile, [string[]]$Argomenti = @())
  $precedente = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Eseguibile @Argomenti 2>&1 | ForEach-Object { "$_" }
    return (($out -join "`n").Trim())
  } catch {
    return $_.Exception.Message
  } finally {
    $ErrorActionPreference = $precedente
  }
}

# ---------------------------------------------------------------- porte e processi

<# Processo che ascolta sulla porta (nome, PID e riga di comando). #>
function Get-Listener([int]$Port) {
  $conn = $null
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
  } catch { }
  if (-not $conn) { return $null }
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  $nome = '?'
  if ($proc) { $nome = $proc.ProcessName }
  $riga = $null
  try {
    $riga = (Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction Stop).CommandLine
  } catch { }
  return [pscustomobject]@{
    Port        = $Port
    Pid         = $conn.OwningProcess
    Nome        = $nome
    CommandLine = $riga
  }
}

<# True se qualcosa risponde sulla porta. Prova IPv4 e IPv6: il dev server di Vite
   ascolta su "::1" (solo IPv6), quindi controllare 127.0.0.1 non basta. #>
function Test-Porta([int]$Port) {
  foreach ($indirizzo in @([System.Net.IPAddress]::Loopback, [System.Net.IPAddress]::IPv6Loopback)) {
    $client = New-Object System.Net.Sockets.TcpClient($indirizzo.AddressFamily)
    try {
      $iar = $client.BeginConnect($indirizzo, $Port, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(400)) {
        $client.EndConnect($iar)
        return $true
      }
    } catch {
      # connessione rifiutata: si prova l'indirizzo successivo
    } finally {
      $client.Close()
    }
  }
  return $false
}

<# Attende che la porta risponda (max $TimeoutSec secondi). #>
function Wait-Porta([int]$Port) {
  $scadenza = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $scadenza) {
    if (Test-Porta $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

<# Ferma il server sulla porta, ma SOLO se il processo appartiene a questo repo. #>
function Stop-Server([string]$Etichetta, [int]$Port) {
  $l = Get-Listener $Port
  if (-not $l) {
    Write-Host ("  {0,-8} porta {1}: già libera" -f $Etichetta, $Port) -ForegroundColor DarkGray
    return
  }
  $nostro = $l.CommandLine -and ($l.CommandLine -like "*$root*")
  if (-not $nostro) {
    Write-Warning ("  {0,-8} porta {1}: occupata da '{2}' (PID {3}), che non è di questo repo: non la tocco" -f $Etichetta, $Port, $l.Nome, $l.Pid)
    return
  }
  Write-Host ("  {0,-8} porta {1}: fermo {2} (PID {3})" -f $Etichetta, $Port, $l.Nome, $l.Pid) -ForegroundColor Yellow
  Stop-Process -Id $l.Pid -Force -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 24 -and (Test-Porta $Port); $i++) { Start-Sleep -Milliseconds 250 }
}

# ---------------------------------------------------------------- prerequisiti

<#
  Costruisce l'elenco dei prerequisiti con: nome, se c'è, dettaglio (versione trovata), come rimediare.
  Ogni voce è un oggetto, così la stessa funzione serve al report di -Diagnosi e ai controlli dell'avvio.
#>
function Get-Requisiti {
  $esiti = New-Object System.Collections.ArrayList
  $aggiungi = {
    param([string]$Nome, [bool]$Ok, [string]$Dettaglio, [string]$Rimedio, [string]$Obbligatorio)
    [void]$esiti.Add([pscustomobject]@{
      Nome         = $Nome
      Ok           = $Ok
      Dettaglio    = $Dettaglio
      Rimedio      = $Rimedio
      Obbligatorio = $Obbligatorio
    })
  }

  # 1) PowerShell che esegue questo script
  & $aggiungi 'PowerShell' $true ("versione {0} ({1})" -f $PSVersionTable.PSVersion, $PSVersionTable.PSEdition) '' 'sì'

  # 2) .NET SDK (backend ASP.NET Core)
  $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
  if (-not $dotnet) {
    & $aggiungi '.NET SDK 10' $false 'comando "dotnet" non trovato nel PATH' `
      'Installa .NET 10 SDK da https://dotnet.microsoft.com/download (poi riapri il terminale)' 'sì'
  } else {
    $ver = Invoke-Esterno 'dotnet' @('--version')
    $sdks = Invoke-Esterno 'dotnet' @('--list-sdks')
    $haDieci = $sdks -match '(?m)^\s*10\.'
    & $aggiungi '.NET SDK 10' $haDieci ("dotnet {0}; SDK installati:`n{1}" -f $ver, $sdks) `
      'Serve la versione 10: https://dotnet.microsoft.com/download/dotnet/10.0' 'sì'
  }

  # 3) Node.js e npm (frontend React + Vite)
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    & $aggiungi 'Node.js 20+' $false 'comando "node" non trovato nel PATH' `
      'Installa Node.js LTS da https://nodejs.org (poi riapri il terminale)' 'sì'
  } else {
    $verNode = Invoke-Esterno 'node' @('--version')
    $maggiore = 0
    if ($verNode -match 'v?(\d+)\.') { $maggiore = [int]$Matches[1] }
    & $aggiungi 'Node.js 20+' ($maggiore -ge 20) ("node {0}" -f $verNode) `
      'Serve Node 20 o più recente: https://nodejs.org' 'sì'
  }
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    & $aggiungi 'npm' $false 'comando "npm" non trovato nel PATH' 'Arriva con Node.js: reinstalla Node LTS' 'sì'
  } else {
    $verNpm = Invoke-Esterno 'npm' @('--version')
    & $aggiungi 'npm' $true ("npm {0}" -f $verNpm) '' 'sì'
  }

  # 4) dipendenze del frontend: NON sono un prerequisito da installare a mano — se mancano le
  # installa lo script (npm install). Per questo non sono obbligatorie: segnalarle non deve fermare
  # l'avvio, altrimenti su un computer nuovo l'app non partirebbe mai al primo colpo.
  # Aggancio per le PROVE: STARTAPP_SIMULA_NODE_MODULES=1 fa finta che node_modules manchi, così si
  # vede il percorso di installazione senza toccare la cartella vera.
  $nodeModules = Join-Path $frontendDir 'node_modules'
  if ($env:STARTAPP_SIMULA_NODE_MODULES) { $nodeModules = Join-Path $frontendDir 'node_modules_simulato_assente' }
  if (Test-Path $nodeModules) {
    & $aggiungi 'Dipendenze frontend (node_modules)' $true 'presenti' '' 'no'
  } else {
    & $aggiungi 'Dipendenze frontend (node_modules)' $false 'cartella assente: le installo io adesso' `
      'Non devi fare niente: parte npm install (serve internet, qualche minuto). A mano sarebbe: cd frontend; npm install' 'no'
  }

  # 5) porte libere (o occupate da un server di QUESTO repo, che va bene: si riusa)
  foreach ($p in @(@{ Etichetta = 'Backend'; Porta = $backendPort }, @{ Etichetta = 'App'; Porta = $appPort })) {
    $l = Get-Listener $p.Porta
    if (-not $l) {
      & $aggiungi ("Porta {0} ({1})" -f $p.Porta, $p.Etichetta) $true 'libera' '' 'sì'
    } else {
      $nostro = $l.CommandLine -and ($l.CommandLine -like "*$root*")
      $dettaglio = ("occupata da {0} (PID {1}){2}" -f $l.Nome, $l.Pid, $(if ($nostro) { ', è di questo progetto: viene riusata' } else { ', NON è di questo progetto' }))
      & $aggiungi ("Porta {0} ({1})" -f $p.Porta, $p.Etichetta) $nostro $dettaglio `
        ("Chiudi il programma che la usa (PID {0}) oppure cambia porta nei parametri dello script" -f $l.Pid) 'sì'
    }
  }

  # Aggancio per le PROVE: STARTAPP_SIMULA_MANCANZA="Node.js 20+,npm" fa finta che quei prerequisiti
  # manchino, così si può verificare il messaggio "MANCA: ..." senza disinstallare niente.
  if ($env:STARTAPP_SIMULA_MANCANZA) {
    foreach ($nome in ($env:STARTAPP_SIMULA_MANCANZA -split ',')) {
      $quello = $nome.Trim()
      if (-not $quello) { continue }
      foreach ($e in $esiti) {
        if ($e.Nome -like "*$quello*") {
          $e.Ok = $false
          $e.Dettaglio = 'simulato mancante (prova)'
          $e.Rimedio = "Installa $quello (simulazione per la prova del messaggio)"
        }
      }
    }
  }
  # 6) informazioni: l'istanza SQL Server e la login si scelgono NELL'APP (schermata di connessione)
  & $aggiungi 'Istanza SQL Server' $true 'la scegli nella schermata di connessione dell''app (es. .\sql2019dev)' `
    'Serve un''istanza SQL Server raggiungibile con autenticazione SQL o Windows' 'no'

  return $esiti
}

<# Elenca SOLO i prerequisiti mancanti, in evidenza: è la parte che deve restare a schermo. #>
function Show-Mancanti($esiti) {
  $mancanti = @($esiti | Where-Object { -not $_.Ok })
  if ($mancanti.Count -eq 0) { return }
  Write-Host ''
  Write-Host '  MANCA:' -ForegroundColor Red
  foreach ($m in $mancanti) {
    Write-Host ("   - {0}: {1}" -f $m.Nome, (($m.Dettaglio -split "`n")[0])) -ForegroundColor Yellow
    if ($m.Rimedio) { Write-Host ("     -> {0}" -f $m.Rimedio) -ForegroundColor DarkYellow }
  }
  Write-Host ''
}
<# Stampa il report dei prerequisiti. Restituisce $true se manca qualcosa di obbligatorio. #>
function Show-Requisiti($esiti) {
  $mancaQualcosa = $false
  foreach ($e in $esiti) {
    $dettaglio = ($e.Dettaglio -split "`n")[0]
    if ($e.Ok) {
      Write-Ok ("{0}: {1}" -f $e.Nome, $dettaglio)
      # le righe successive del dettaglio (es. gli SDK installati) si mostrano rientrate
      $resto = ($e.Dettaglio -split "`n" | Select-Object -Skip 1)
      foreach ($r in $resto) { if ($r.Trim()) { Write-Host ("       {0}" -f $r.Trim()) -ForegroundColor DarkGray } }
    } else {
      if ($e.Obbligatorio -eq 'sì') { $mancaQualcosa = $true }
      Write-Manca ("{0}: {1}" -f $e.Nome, $dettaglio)
      if ($e.Rimedio) { Write-Host ("       -> {0}" -f $e.Rimedio) -ForegroundColor DarkYellow }
      $resto = ($e.Dettaglio -split "`n" | Select-Object -Skip 1)
      foreach ($r in $resto) { if ($r.Trim()) { Write-Host ("       {0}" -f $r.Trim()) -ForegroundColor DarkGray } }
    }
  }
  return $mancaQualcosa
}

# ---------------------------------------------------------------- avvio

<# Apre una finestra con il comando del server e attende che la porta risponda. #>
function Start-Server([string]$Etichetta, [string]$Titolo, [string]$Directory, [string]$Comando, [int]$Port, [string]$Url) {
  $gia = Get-Listener $Port
  if ($gia) {
    Write-Host ("  {0,-8} già attivo su {1} (PID {2}): non lo avvio di nuovo" -f $Etichetta, $Port, $gia.Pid) -ForegroundColor Yellow
    return $true
  }
  if ($Anteprima) {
    Write-Host ("  {0,-8} avvierei: cd '{1}'; {2}" -f $Etichetta, $Directory, $Comando) -ForegroundColor DarkGray
    return $true
  }
  $riga = "cd '{0}'; `$Host.UI.RawUI.WindowTitle = '{1}'; Write-Host '{2}' -ForegroundColor Cyan; {3}" -f $Directory, $Titolo, $Url, $Comando
  Start-Process -FilePath $script:shell -ArgumentList @('-NoExit', '-Command', $riga) | Out-Null
  Write-Host ("  {0,-8} avvio in una nuova finestra..." -f $Etichetta)
  if (Wait-Porta $Port) {
    Write-Host ("  {0,-8} pronto su {1}" -f $Etichetta, $Url) -ForegroundColor Green
    return $true
  }
  Write-Warning ("  {0,-8} non risponde su {1} entro {2}s: guarda il messaggio nella sua finestra" -f $Etichetta, $Url, $TimeoutSec)
  return $false
}

# ---------------------------------------------------------------- stop

if ($Stop) {
  Write-Titolo 'Fermo i server'
  Stop-Server 'BACKEND' $backendPort
  Stop-Server 'APP'     $appPort
  Write-Host "`nFatto (le due finestre possono essere chiuse)." -ForegroundColor Green
  return
}

# ---------------------------------------------------------------- diagnosi

if ($Diagnosi) {
  Write-Titolo 'Diagnosi dei prerequisiti'
  Write-Host ("  cartella del progetto: {0}" -f $root) -ForegroundColor DarkGray
  $esiti = Get-Requisiti
  $manca = Show-Requisiti $esiti
  Write-Titolo 'Esito'
  if ($manca) {
    Show-Mancanti $esiti
    Write-Host '  Nota: la riga [--] "Dipendenze frontend" si risolve da sola al primo avvio (npm install).' -ForegroundColor DarkGray
    Wait-Chiusura 'Premi un tasto qualsiasi per chiudere la finestra...'
    exit 1
  }
  Write-Host '  Tutto a posto: puoi avviare con .\scripts\start-app.ps1 (oppure avvia.cmd).' -ForegroundColor Green
  Wait-Chiusura
  exit 0
}

# ---------------------------------------------------------------- prerequisiti (avvio)

Write-Titolo 'Prerequisiti'
$esiti = Get-Requisiti
$manca = Show-Requisiti $esiti
if ($manca) {
  Write-Titolo 'Non posso avviare'
  Show-Mancanti $esiti
  Write-Host '  Vuoi il rapporto completo?  .\scripts\start-app.ps1 -Diagnosi' -ForegroundColor Yellow
  Wait-Chiusura 'Premi un tasto qualsiasi per chiudere la finestra...'
  exit 1
}

# node_modules mancante: si installa (o si segnala con -SkipInstall)
$nodeModules = Join-Path $frontendDir 'node_modules'
if ($env:STARTAPP_SIMULA_NODE_MODULES) { $nodeModules = Join-Path $frontendDir 'node_modules_simulato_assente' }
if (-not (Test-Path $nodeModules)) {
  if ($SkipInstall) {
    Write-Host "  frontend\node_modules manca: esegui 'npm install' in frontend (oppure togli -SkipInstall)." -ForegroundColor Yellow
    exit 1
  }
  Write-Host ''
  Write-Host '  Dipendenze del frontend non ancora installate: le installo adesso (npm install).' -ForegroundColor Yellow
  Write-Host '  Serve la connessione a internet e puo richiedere qualche minuto. Non e un errore:' -ForegroundColor DarkGray
  Write-Host '  la cartella frontend\node_modules viene creata una volta sola al primo avvio.' -ForegroundColor DarkGray
  Write-Host ''
  if ($Anteprima) {
    Write-Host ("  avvierei: cd '{0}'; npm install" -f $frontendDir) -ForegroundColor DarkGray
  } else {
    Push-Location $frontendDir
    try {
      $ErrorActionPreference = 'Continue'
      & npm install
      if ($LASTEXITCODE -ne 0) {
        Write-Host "`n  npm install è fallito (codice $LASTEXITCODE). Di solito basta rilanciarlo." -ForegroundColor Yellow
        Write-Host '  Prova a mano:  cd frontend; npm install' -ForegroundColor Gray
        Write-Host '  Se sbaglia ancora:' -ForegroundColor Gray
        Write-Host '   - controlla la connessione (serve internet per scaricare i pacchetti)' -ForegroundColor DarkGray
        Write-Host '   - dietro un proxy aziendale:  npm config set proxy http://utente:password@proxy:porta' -ForegroundColor DarkGray
        Write-Host '   - cache rovinata:  npm cache clean --force   poi riprova' -ForegroundColor DarkGray
        Write-Host '   - Node troppo vecchio: serve Node 20 o più recente (node --version)' -ForegroundColor DarkGray
        Write-Host ''
        Wait-Chiusura 'Premi un tasto qualsiasi per chiudere la finestra...'
        exit 1
      }
    } finally {
      $ErrorActionPreference = 'Stop'
      Pop-Location
    }
  }
}

$script:shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $script:shell) { $script:shell = (Get-Command powershell -ErrorAction SilentlyContinue).Source }

# ---------------------------------------------------------------- avvio dei due server

Write-Titolo 'Backend (ASP.NET Core, porta 5213)'
$okBackend = Start-Server 'BACKEND' 'BACKEND - SQL Intelligence' $backendDir 'dotnet run' $backendPort $backendUrl

Write-Titolo 'App (React + Vite, porta 5173)'
$okApp = Start-Server 'APP' 'APP - SQL Intelligence' $frontendDir 'npm run dev' $appPort $appUrl

if ($okApp -and -not $NoBrowser -and -not $Anteprima) { Start-Process $appUrl }

Write-Titolo 'Riepilogo'
if ($okApp)     { Write-Host ("  app      : {0}" -f $appUrl) -ForegroundColor Green }     else { Write-Host ("  app      : NON attiva ({0})" -f $appUrl) -ForegroundColor Red }
if ($okBackend) { Write-Host ("  backend  : {0}   (l'app inoltra /api da sola)" -f $backendUrl) -ForegroundColor Green } else { Write-Host ("  backend  : NON attivo ({0})" -f $backendUrl) -ForegroundColor Red }
Write-Host '  per fermarli: .\scripts\start-app.ps1 -Stop'
Write-Host '  se qualcosa non parte: .\scripts\start-app.ps1 -Diagnosi'
