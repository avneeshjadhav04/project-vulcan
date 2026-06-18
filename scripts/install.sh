#!/bin/sh
set -e

# Project Vulcan — Universal Installer
# Supports: Linux, macOS, WSL
# Architecture: amd64, arm64

REPO="avneeshjadhav04/project-vulcan"
REGISTRY="ghcr.io"
IMAGE="${REGISTRY}/${REPO}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/vulcan}"
COMPOSE_URL="https://raw.githubusercontent.com/${REPO}/main/docker-compose.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_banner() {
    echo ""
    echo "  ██╗   ██╗██╗   ██╗██╗      ██████╗ ███████╗███╗   ██╗"
    echo "  ██║   ██║██║   ██║██║     ██╔════╝ ██╔════╝████╗  ██║"
    echo "  ██║   ██║██║   ██║██║     ██║  ███╗█████╗  ██╔██╗ ██║"
    echo "  ╚██╗ ██╔╝██║   ██║██║     ██║   ██║██╔══╝  ██║╚██╗██║"
    echo "   ╚████╔╝ ╚██████╔╝███████╗╚██████╔╝███████╗██║ ╚████║"
    echo "    ╚═══╝   ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝"
    echo ""
    echo "  Personal AI Assistant Platform"
    echo ""
}

check_dependency() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "${RED}Error: $1 is required but not installed.${NC}"
        echo "Please install Docker and Docker Compose, then re-run this script."
        exit 1
    fi
}

generate_master_key() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import secrets; print(secrets.token_hex(32))"
    elif command -v node >/dev/null 2>&1; then
        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    else
        # Fallback: use /dev/urandom
        head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64
    fi
}

print_banner

echo "${YELLOW}Checking dependencies...${NC}"
check_dependency docker
check_dependency "docker compose"
echo "${GREEN}Dependencies OK.${NC}"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)
        PLATFORM="linux/amd64"
        ;;
    aarch64|arm64)
        PLATFORM="linux/arm64"
        ;;
    *)
        echo "${YELLOW}Warning: Architecture $ARCH may not be officially supported.${NC}"
        echo "Supported: amd64, arm64. Attempting anyway..."
        PLATFORM="linux/${ARCH}"
        ;;
esac

echo ""
echo "Detected platform: ${GREEN}${PLATFORM}${NC}"

# Create install directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Download compose file
echo ""
echo "${YELLOW}Downloading docker-compose.yml...${NC}"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o docker-compose.yml "$COMPOSE_URL"
elif command -v wget >/dev/null 2>&1; then
    wget -q -O docker-compose.yml "$COMPOSE_URL"
else
    echo "${RED}Error: curl or wget is required.${NC}"
    exit 1
fi
echo "${GREEN}Downloaded docker-compose.yml${NC}"

# Setup environment
if [ ! -f .env ]; then
    echo ""
    echo "${YELLOW}Generating .env configuration...${NC}"
    MASTER_KEY=$(generate_master_key)
    cat > .env <<EOF
# Project Vulcan Environment Configuration
# Generated on $(date -Iseconds)

# Master encryption key (32+ bytes). Auto-generated if not set.
MASTER_KEY=${MASTER_KEY}

# SQLite database path
DATABASE_URL=sqlite:/data/vulcan.db

# Logging level (trace, debug, info, warn, error)
RUST_LOG=info

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
EOF
    echo "${GREEN}Created .env with auto-generated MASTER_KEY${NC}"
    echo ""
    echo "${YELLOW}Your MASTER_KEY:${NC} ${MASTER_KEY}"
    echo "${YELLOW}Store this safely. It encrypts your API keys and credentials.${NC}"
else
    echo ""
    echo "${GREEN}.env already exists. Keeping existing configuration.${NC}"
fi

# Create data directories
mkdir -p data workspace

# Pull and start
echo ""
echo "${YELLOW}Pulling Project Vulcan image...${NC}"
docker compose pull

echo ""
echo "${YELLOW}Starting Project Vulcan...${NC}"
docker compose up -d

# Create CLI wrapper
CLI_WRAPPER="$HOME/.local/bin/vulcan"
mkdir -p "$HOME/.local/bin"

cat > "$CLI_WRAPPER" <<'EOF'
#!/bin/sh
# Project Vulcan CLI wrapper

INSTALL_DIR="${VULCAN_DIR:-$HOME/vulcan}"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: Vulcan not found at $INSTALL_DIR"
    echo "Run the installer first:"
    echo "  curl -fsSL ... | bash"
    exit 1
fi

cd "$INSTALL_DIR"

case "${1:-}" in
    start)
        docker compose up -d
        echo "Vulcan started at http://localhost:8080"
        ;;
    stop)
        docker compose down
        echo "Vulcan stopped."
        ;;
    update)
        echo "Pulling latest image..."
        docker compose pull
        echo "Restarting..."
        docker compose up -d
        echo "Vulcan updated."
        ;;
    logs)
        docker compose logs -f
        ;;
    status)
        docker compose ps
        ;;
    uninstall)
        echo "This will stop Vulcan and optionally remove all data."
        printf "Remove data directory ($INSTALL_DIR/data)? [y/N]: "
        read -r REMOVE_DATA
        docker compose down
        if [ "$REMOVE_DATA" = "y" ] || [ "$REMOVE_DATA" = "Y" ]; then
            docker compose down -v
            rm -rf "$INSTALL_DIR/data"
            rm -rf "$INSTALL_DIR/workspace"
            echo "Data removed."
        fi
        rm -f "$0"
        echo "Vulcan uninstalled."
        ;;
    *)
        echo "Project Vulcan CLI"
        echo ""
        echo "Usage: vulcan <command>"
        echo ""
        echo "Commands:"
        echo "  start      Start Vulcan"
        echo "  stop       Stop Vulcan"
        echo "  update     Pull latest image and restart"
        echo "  logs       View logs"
        echo "  status     Check container status"
        echo "  uninstall  Remove Vulcan"
        echo ""
        echo "Data directory: $INSTALL_DIR"
        ;;
esac
EOF
chmod +x "$CLI_WRAPPER"

# Add to PATH if needed
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    echo ""
    echo "${YELLOW}Adding ~/.local/bin to PATH...${NC}"
    SHELL_RC=""
    case "$SHELL" in
        */bash) SHELL_RC="$HOME/.bashrc" ;;
        */zsh)  SHELL_RC="$HOME/.zshrc" ;;
        */fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
    esac
    if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
        echo "${GREEN}Added to $SHELL_RC. Run 'source $SHELL_RC' to apply.${NC}"
    fi
fi

# Wait for healthcheck
echo ""
echo "${YELLOW}Waiting for Vulcan to be ready...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0
while [ "$RETRY_COUNT" -lt "$MAX_RETRIES" ]; do
    if wget --spider -q http://localhost:8080/api/health 2>/dev/null; then
        echo "${GREEN}Vulcan is running!${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    sleep 2
done

if [ "$RETRY_COUNT" -eq "$MAX_RETRIES" ]; then
    echo "${YELLOW}Vulcan is starting but not yet responding to health checks.${NC}"
    echo "It may take a minute on first boot. Check logs with: vulcan logs"
fi

echo ""
echo "================================================"
echo "  ${GREEN}Project Vulcan installed successfully!${NC}"
echo "================================================"
echo ""
echo "  Access:     http://localhost:8080"
echo "  Data:       $INSTALL_DIR/data"
echo "  Workspace:  $INSTALL_DIR/workspace"
echo ""
echo "  Commands:"
echo "    vulcan start      - Start Vulcan"
echo "    vulcan stop       - Stop Vulcan"
echo "    vulcan update     - Update to latest version"
echo "    vulcan logs       - View logs"
echo "    vulcan status     - Check status"
echo "    vulcan uninstall  - Remove Vulcan"
echo ""
echo "  First time? Open http://localhost:8080 and sign up."
echo ""
