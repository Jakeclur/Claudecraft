@echo off
title Cave Craft server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page: pick the green LTS button, install it, then double-click this file again.
  start https://nodejs.org
  pause
  exit /b
)
if not exist node_modules (
  echo First time setup, please wait...
  call npm install
)
echo.
echo Starting Cave Craft. Keep this window open while you play. Close it to stop.
start "" http://localhost:3000
node server.js
pause
