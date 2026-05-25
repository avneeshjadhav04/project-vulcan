# Project Vulcan — Uninstall Script (PowerShell)

$INSTALL_DIR = if ($env:VULCAN_DIR) { $env:VULCAN_DIR } else { "$HOME\vulcan" }

Write-Host "Project Vulcan Uninstall" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will:" -ForegroundColor White
Write-Host "  1. Stop and remove Vulcan containers" -ForegroundColor White
Write-Host "  2. Optionally remove Docker volumes and data" -ForegroundColor White
Write-Host ""

if (-not (Test-Path $INSTALL_DIR)) {
    Write-Host "Error: Vulcan not found at $INSTALL_DIR" -ForegroundColor Red
    Write-Host "Nothing to uninstall." -ForegroundColor Red
    exit 1
}

Set-Location $INSTALL_DIR

$REMOVE_DATA = Read-Host "Remove data directory ($INSTALL_DIR\data)? [y/N]"
$REMOVE_WORKSPACE = Read-Host "Remove workspace directory ($INSTALL_DIR\workspace)? [y/N]"
$REMOVE_ALL = Read-Host "Remove entire Vulcan directory ($INSTALL_DIR)? [y/N]"

Write-Host ""
Write-Host "Stopping containers..." -ForegroundColor Yellow
docker compose down

if ($REMOVE_DATA -eq "y" -or $REMOVE_DATA -eq "Y") {
    docker compose down -v 2>$null
    Remove-Item -Recurse -Force "$INSTALL_DIR\data" -ErrorAction SilentlyContinue
    Write-Host "Data directory removed." -ForegroundColor Green
}

if ($REMOVE_WORKSPACE -eq "y" -or $REMOVE_WORKSPACE -eq "Y") {
    Remove-Item -Recurse -Force "$INSTALL_DIR\workspace" -ErrorAction SilentlyContinue
    Write-Host "Workspace directory removed." -ForegroundColor Green
}

if ($REMOVE_ALL -eq "y" -or $REMOVE_ALL -eq "Y") {
    Remove-Item -Recurse -Force $INSTALL_DIR -ErrorAction SilentlyContinue
    Write-Host "Vulcan directory removed." -ForegroundColor Green
}

# Remove CLI wrapper
$CLI_PATH = "$HOME\AppData\Local\Microsoft\WindowsApps\vulcan.ps1"
$CMD_PATH = "$HOME\AppData\Local\Microsoft\WindowsApps\vulcan.cmd"
if (Test-Path $CLI_PATH) { Remove-Item $CLI_PATH -Force }
if (Test-Path $CMD_PATH) { Remove-Item $CMD_PATH -Force }
Write-Host "CLI wrapper removed." -ForegroundColor Green

Write-Host ""
Write-Host "Project Vulcan has been uninstalled." -ForegroundColor Green
