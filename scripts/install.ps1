#!/usr/bin/env pwsh
# Project Vulcan — Windows Installer (PowerShell)
# Supports: Windows 10/11 with Docker Desktop

$ErrorActionPreference = "Stop"

$REPO = "avneeshjadhav04/project-vulcan"
$REGISTRY = "ghcr.io"
$IMAGE = "${REGISTRY}/${REPO}"
$INSTALL_DIR = if ($env:VULCAN_DIR) { $env:VULCAN_DIR } else { "$HOME\vulcan" }
$COMPOSE_URL = "https://raw.githubusercontent.com/${REPO}/main/docker-compose.yml"

function Print-Banner {
    Write-Host ""
    Write-Host "  V U L C A N" -ForegroundColor Cyan
    Write-Host "  Personal AI Assistant Platform" -ForegroundColor DarkGray
    Write-Host ""
}

function Check-Dependency($Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "Error: $Name is required but not installed." -ForegroundColor Red
        Write-Host "Please install Docker Desktop for Windows and re-run this script." -ForegroundColor Red
        exit 1
    }
}

function Generate-MasterKey {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    [BitConverter]::ToString($bytes).Replace("-", "").ToLower()
}

Print-Banner

Write-Host "Checking dependencies..." -ForegroundColor Yellow
Check-Dependency "docker"
Write-Host "Dependencies OK." -ForegroundColor Green

# Detect architecture
$ARCH = if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") { "amd64" } else { $env:PROCESSOR_ARCHITECTURE.ToLower() }
Write-Host "Detected architecture: $ARCH" -ForegroundColor Green

# Create directories
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null
Set-Location $INSTALL_DIR

# Download compose file
Write-Host ""
Write-Host "Downloading docker-compose.yml..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $COMPOSE_URL -OutFile "docker-compose.yml" -UseBasicParsing
Write-Host "Downloaded docker-compose.yml" -ForegroundColor Green

# Setup environment
if (-not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "Generating .env configuration..." -ForegroundColor Yellow
    $MASTER_KEY = Generate-MasterKey
    @"
# Project Vulcan Environment Configuration
# Generated on $(Get-Date -Format "o")

# Master encryption key (32+ bytes). Auto-generated if not set.
MASTER_KEY=${MASTER_KEY}

# SQLite database path
DATABASE_URL=sqlite:/data/vulcan.db

# Logging level (trace, debug, info, warn, error)
RUST_LOG=info

# Default NVIDIA NIM endpoint (optional — users can add providers via UI)
NIM_BASE_URL=https://integrate.api.nvidia.com/v1

# Application base URL (for OAuth redirect callbacks)
APP_BASE_URL=http://localhost:8080

# Optional: Google OAuth2 credentials for Calendar + Gmail integration
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Optional: Todoist OAuth2 credentials for task integration
# TODOIST_CLIENT_ID=
# TODOIST_CLIENT_SECRET=

# Optional: disable AI tool execution
# DISABLE_TOOLS=1
"@ | Out-File -Encoding utf8 .env
    Write-Host "Created .env with auto-generated MASTER_KEY" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your MASTER_KEY: $MASTER_KEY" -ForegroundColor Yellow
    Write-Host "Store this safely. It encrypts your API keys and credentials." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host ".env already exists. Keeping existing configuration." -ForegroundColor Green
}

# Create data directories
New-Item -ItemType Directory -Force -Path "data", "workspace" | Out-Null

# Pull and start
Write-Host ""
Write-Host "Pulling Project Vulcan image..." -ForegroundColor Yellow
docker compose pull

Write-Host ""
Write-Host "Starting Project Vulcan..." -ForegroundColor Yellow
docker compose up -d

# Create CLI wrapper
$CLI_DIR = "$HOME\AppData\Local\Microsoft\WindowsApps"
$CLI_PATH = "$CLI_DIR\vulcan.ps1"

$CLI_SCRIPT = @'
# Project Vulcan CLI wrapper
param(
    [Parameter(Position=0)]
    [string]$Command
)

$INSTALL_DIR = if ($env:VULCAN_DIR) { $env:VULCAN_DIR } else { "$HOME\vulcan" }
$COMPOSE_FILE = "$INSTALL_DIR\docker-compose.yml"

if (-not (Test-Path $COMPOSE_FILE)) {
    Write-Host "Error: Vulcan not found at $INSTALL_DIR" -ForegroundColor Red
    Write-Host "Run the installer first." -ForegroundColor Red
    exit 1
}

Set-Location $INSTALL_DIR

switch ($Command) {
    "start" {
        docker compose up -d
        Write-Host "Vulcan started at http://localhost:8080" -ForegroundColor Green
    }
    "stop" {
        docker compose down
        Write-Host "Vulcan stopped." -ForegroundColor Green
    }
    "update" {
        Write-Host "Pulling latest image..." -ForegroundColor Yellow
        docker compose pull
        Write-Host "Restarting..." -ForegroundColor Yellow
        docker compose up -d
        Write-Host "Vulcan updated." -ForegroundColor Green
    }
    "logs" {
        docker compose logs -f
    }
    "status" {
        docker compose ps
    }
    "uninstall" {
        $confirm = Read-Host "Remove data directory ($INSTALL_DIR\data)? [y/N]"
        docker compose down
        if ($confirm -eq "y" -or $confirm -eq "Y") {
            docker compose down -v
            Remove-Item -Recurse -Force "$INSTALL_DIR\data" -ErrorAction SilentlyContinue
            Remove-Item -Recurse -Force "$INSTALL_DIR\workspace" -ErrorAction SilentlyContinue
            Write-Host "Data removed." -ForegroundColor Green
        }
        Remove-Item -Path $PSCommandPath -Force
        Write-Host "Vulcan uninstalled." -ForegroundColor Green
    }
    default {
        Write-Host "Project Vulcan CLI" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Usage: vulcan <command>" -ForegroundColor White
        Write-Host ""
        Write-Host "Commands:" -ForegroundColor White
        Write-Host "  start      Start Vulcan"
        Write-Host "  stop       Stop Vulcan"
        Write-Host "  update     Pull latest image and restart"
        Write-Host "  logs       View logs"
        Write-Host "  status     Check container status"
        Write-Host "  uninstall  Remove Vulcan"
        Write-Host ""
        Write-Host "Data directory: $INSTALL_DIR" -ForegroundColor DarkGray
    }
}
'@

New-Item -ItemType Directory -Force -Path $CLI_DIR | Out-Null
$CLI_SCRIPT | Out-File -Encoding utf8 $CLI_PATH

# Also create a .cmd wrapper for convenience
$CMD_PATH = "$CLI_DIR\vulcan.cmd"
"@powershell -ExecutionPolicy Bypass -File `"$CLI_PATH`" %*" | Out-File -Encoding ascii $CMD_PATH

Write-Host ""
Write-Host "Waiting for Vulcan to be ready..." -ForegroundColor Yellow
$MAX_RETRIES = 30
$RETRY_COUNT = 0
$READY = $false

while ($RETRY_COUNT -lt $MAX_RETRIES) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -Method GET -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $READY = $true
            break
        }
    } catch {
        # Not ready yet
    }
    $RETRY_COUNT++
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Project Vulcan installed successfully!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Access:     http://localhost:8080" -ForegroundColor White
Write-Host "  Data:       $INSTALL_DIR\data" -ForegroundColor White
Write-Host "  Workspace:  $INSTALL_DIR\workspace" -ForegroundColor White
Write-Host ""
Write-Host "  Commands:" -ForegroundColor White
Write-Host "    vulcan start      - Start Vulcan" -ForegroundColor Gray
Write-Host "    vulcan stop       - Stop Vulcan" -ForegroundColor Gray
Write-Host "    vulcan update     - Update to latest version" -ForegroundColor Gray
Write-Host "    vulcan logs       - View logs" -ForegroundColor Gray
Write-Host "    vulcan status     - Check status" -ForegroundColor Gray
Write-Host "    vulcan uninstall  - Remove Vulcan" -ForegroundColor Gray
Write-Host ""
Write-Host "  First time? Open http://localhost:8080 and sign up." -ForegroundColor Yellow
Write-Host ""
