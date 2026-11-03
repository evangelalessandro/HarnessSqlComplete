@echo off
rem -------------------------------------------------------------------------------------------
rem  Avvio di SQL Intelligence Assistant con DOPPIO CLIC.
rem
rem  Uso:  avvia.cmd             avvia backend e app
rem        avvia.cmd -Diagnosi   controlla solo i prerequisiti e ti dice cosa manca
rem        avvia.cmd -Stop       ferma i due server
rem
rem  La finestra NON si chiude da sola: a fine script attende un tasto, così si leggono sempre sia
rem  l'elenco di cosa manca sia gli eventuali errori (prima il testo rosso spariva subito).
rem -------------------------------------------------------------------------------------------
setlocal
pushd "%~dp0"

if not exist "scripts\start-app.ps1" (
  echo.
  echo   Non trovo scripts\start-app.ps1: questa cartella non sembra il progetto giusto.
  echo   Cartella corrente: %CD%
  echo.
  pause
  popd
  exit /b 1
)

rem -NoProfile: non carica profili personali; -ExecutionPolicy Bypass: niente blocchi di policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-app.ps1" %*
set "CODICE=%ERRORLEVEL%"

echo.
if not "%CODICE%"=="0" (
  echo   Lo script e' terminato con il codice %CODICE%.
  echo   Per il rapporto completo sui prerequisiti:  avvia.cmd -Diagnosi
) else (
  echo   Fatto. Le due finestre dei server restano aperte: per fermarli usa  avvia.cmd -Stop
)
echo.
pause

popd
exit /b %CODICE%
