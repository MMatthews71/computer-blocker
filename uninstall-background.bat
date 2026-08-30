@echo off
REM ============================================================================
REM  FocusLock - remove the always-on background service
REM
REM  Undoes install-background.bat:
REM    1. Removes both Scheduled Tasks (so nothing auto-starts anymore).
REM    2. Stops the running service on port 47615.
REM    3. Deletes the generated watchdog helper.
REM
REM  Your rules and settings are left untouched. The browser extension is not
REM  changed here - disable it yourself at chrome://extensions if you want it off.
REM ============================================================================

setlocal
cd /d "%~dp0"

set "VBS=%~dp0.focuslock-watchdog.vbs"
set "TASK_WATCH=FocusLock Service Watchdog"
set "TASK_LOGON=FocusLock Service Startup"

echo(
echo   FocusLock - background service uninstall
echo   ========================================
echo(

REM --- 1. Remove the scheduled tasks (so the watchdog stops restarting it) ----
echo   Removing scheduled tasks...
schtasks /Delete /TN "%TASK_WATCH%" /F >nul 2>nul
schtasks /Delete /TN "%TASK_LOGON%" /F >nul 2>nul

REM --- 2. Stop any running service on port 47615 ------------------------------
echo   Stopping the service on port 47615...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :47615 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>nul
    echo     stopped process %%a
)

REM --- 3. Delete the generated watchdog helper --------------------------------
if exist "%VBS%" (
    del /f /q "%VBS%" >nul 2>nul
    echo   Removed watchdog helper.
)

echo(
echo   Done. The always-on service has been removed.
echo   (To also turn off enforcement, disable FocusLock at chrome://extensions.)
echo(
pause
endlocal
exit /b 0
