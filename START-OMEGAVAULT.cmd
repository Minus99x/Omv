@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.12 or newer and run this file again.
  pause
  exit /b 1
)
node scripts\resume-workstation.js --check-runtime
if errorlevel 1 (
  echo OmegaVault requires Node.js 22.12 or newer.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Restoring and verifying the pinned OmegaVault workstation dependencies...
  call npm run resume:workstation
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Starting OmegaVault...
echo.
npm start
pause
