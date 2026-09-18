<#
  Avvia (o ferma) i due server di SQL Intelligence Assistant in due finestre separate:
    - BACKEND  ASP.NET Core  -> http://localhost:5213
    - APP      React + Vite  -> http://localhost:5173  (Vite inoltra /api al backend)

  Uso:
    .\scripts\start-app.ps1                 avvia backend e app e apre il browser
    .\scripts\start-app.ps1 -Stop           ferma i due server
    .\scripts\start-app.ps1 -NoBrowser      avvia senza aprire il browser
    .\scripts\start-app.ps1 -SkipInstall    errore (invece di npm install) se manca node_modules

  Se PowerShell blocca lo script per la ExecutionPolicy:
    powershell -ExecutionPolicy Bypass -File .\scripts\start-app.ps1
#>
[CmdletBinding()]
param(
  [switch]$Stop,
  [switch]$NoBrowser,
  [switch]$SkipInstall,
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

# ---------------------------------------------------------------- avvio

<# Apre una finestra con il comando del server e attende che la porta risponda. #>
function Start-Server([string]$Etichetta, [string]$Titolo, [string]$Directory, [string]$Comando, [int]$Port, [string]$Url) {
  $gia = Get-Listener $Port
  if ($gia) {
    Write-Host ("  {0,-8} già attivo su {1} (PID {2}): non lo avvio di nuovo" -f $Etichetta, $Port, $gia.Pid) -ForegroundColor Yellow
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

# ---------------------------------------------------------------- prerequisiti

Write-Titolo 'Prerequisiti'
foreach ($eseguibile in @('dotnet', 'node', 'npm')) {
  if (-not (Get-Command $eseguibile -ErrorAction SilentlyContinue)) {
    throw "Manca '$eseguibile' nel PATH."
  }
}
$script:shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $script:shell) { $script:shell = (Get-Command powershell -ErrorAction SilentlyContinue).Source }
Write-Host ("  dotnet {0} | node {1} | npm {2}" -f (& dotnet --version), (& node --version), (& npm --version))

if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
  if ($SkipInstall) { throw "frontend\node_modules manca: esegui 'npm install' in frontend (oppure togli -SkipInstall)." }
  Write-Host '  frontend: node_modules assente -> npm install (puo richiedere qualche minuto)' -ForegroundColor Yellow
  Push-Location $frontendDir
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install è fallito.' }
  } finally {
    Pop-Location
  }
}

# ---------------------------------------------------------------- avvio dei due server

Write-Titolo 'Backend (ASP.NET Core, porta 5213)'
$okBackend = Start-Server 'BACKEND' 'BACKEND - SQL Intelligence' $backendDir 'dotnet run' $backendPort $backendUrl

Write-Titolo 'App (React + Vite, porta 5173)'
$okApp = Start-Server 'APP' 'APP - SQL Intelligence' $frontendDir 'npm run dev' $appPort $appUrl

if ($okApp -and -not $NoBrowser) { Start-Process $appUrl }

Write-Titolo 'Riepilogo'
if ($okApp)     { Write-Host ("  app      : {0}" -f $appUrl) -ForegroundColor Green }     else { Write-Host ("  app      : NON attiva ({0})" -f $appUrl) -ForegroundColor Red }
if ($okBackend) { Write-Host ("  backend  : {0}   (l'app inoltra /api da sola)" -f $backendUrl) -ForegroundColor Green } else { Write-Host ("  backend  : NON attivo ({0})" -f $backendUrl) -ForegroundColor Red }
Write-Host '  per fermarli: .\scripts\start-app.ps1 -Stop'
