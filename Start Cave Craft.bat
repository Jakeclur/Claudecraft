@echo off
title Cave Craft server
cd /d "%~dp0"
rem Look for Node.js even if Windows has not updated its list yet
set "PATH=%PATH%;C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"
rem Portable Node.js downloaded as a zip (for example in Downloads or on the Desktop)
for /d %%D in ("%USERPROFILE%\Downloads\node-v*-win-x64" "%USERPROFILE%\Downloads\node-v*-win-x64\node-v*-win-x64" "%USERPROFILE%\Desktop\node-v*-win-x64" "%USERPROFILE%\Documents\node-v*-win-x64") do if exist "%%~fD\node.exe" set "PATH=%PATH%;%%~fD"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Could not find Node.js on this computer.
  echo.
  echo 1. If you just installed it, RESTART the computer and double-click this file again.
  echo 2. If you have not installed it: go to https://nodejs.org , press the green LTS button,
  echo    open the downloaded .msi file and keep pressing Next until it finishes.
  echo.
  echo If installing is blocked on this computer, tell your helper which message you see.
  echo.
  pause
  exit /b
)
echo Found Node.js:
node --version
if not exist node_modules (
  echo First time setup, please wait a minute...
  call npm install
)
echo.
echo Starting Cave Craft. Keep this window open while you play. Close it to stop.
start "" http://localhost:3000
node server.js
echo.
echo The server stopped. Message above may say why.
pause
