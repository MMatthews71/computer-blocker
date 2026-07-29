@echo off
REM ============================================================================
REM  FocusLock - verbose launcher (shows a console with logs)
REM
REM  For the normal, NO-TERMINAL experience, double-click FocusLock.vbs instead.
REM  Use this script only when you want to see build output and app logs in a
REM  console (e.g. for troubleshooting).
REM
REM  Requires Node.js >= 18   (https://nodejs.org)
REM ============================================================================

setlocal
cd /d "%~dp0"

REM One-time (or as-needed) install + build.
call "%~dp0setup.bat"
if errorlevel 1 exit /b 1

echo(
echo   Launching FocusLock (verbose)...
echo   The app starts the background service on 127.0.0.1:47615 if needed.
echo(
echo   Tip: to load the browser extension, open chrome://extensions, enable
echo   Developer mode, choose "Load unpacked", and select the apps\extension folder.
echo(

REM Run Electron in this console so you can see its logs.
call npm run electron --workspace @focuslock/desktop

echo(
echo   FocusLock window closed. The background service may still be running
echo   in the background (by design). You can close this window.
echo(
pause
endlocal
