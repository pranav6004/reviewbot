@echo off
title ReviewBot Launcher
echo ==========================================
echo   ReviewBot - Development Runner
echo ==========================================
echo.

echo [1/3] Clearing port 3000 if occupied...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [2/3] Starting Smee Webhook Tunnel in new window...
start "ReviewBot Smee Tunnel" cmd /c "npx -y smee-client -u https://smee.io/cI5sS1dTZf3WPlfp -t http://localhost:3000/api/webhooks/github"

echo [3/3] Starting ReviewBot Server...
echo Smee tunnel is running in background window.
echo Opening Control Center at http://localhost:3000 ...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:3000'"
echo Press Ctrl+C to stop server.
echo.
npm run start --workspace=@reviewbot/server
