@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)
echo Starting OmegaVault...
echo.
npm start
pause
