@echo off
REM ============================================================================
REM  FocusLock - one-time setup (install dependencies + build)
REM
REM  You normally don't run this directly - FocusLock.vbs runs it automatically
REM  the first time. It is visible on purpose so you can watch progress; it
REM  closes by itself when finished, and only pauses if something goes wrong.
REM
REM  Requires Node.js >= 18   (https://nodejs.org)
REM ============================================================================

setlocal
cd /d "%~dp0"

echo(
echo   FocusLock - setup
echo   =================
echo(

where node >nul 2>nul
if errorlevel 1 (
    echo   [X] Node.js was not found on your PATH.
    echo       Install Node.js 18 or newer from https://nodejs.org and re-run.
    echo(
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo   Using Node %%v   (Node 18+ required)

if not exist "node_modules\" (
    echo(
    echo   Installing dependencies ^(first run only, downloads Electron - be patient^)...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [X] npm install failed.
        pause
        exit /b 1
    )
)

echo(
echo   Building packages...
call npm run build
if errorlevel 1 (
    echo   [X] Build failed.
    pause
    exit /b 1
)

echo(
echo   Setup complete.
endlocal
exit /b 0
