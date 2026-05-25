#!/bin/sh
# Project Vulcan — Uninstall Script (Unix)

INSTALL_DIR="${VULCAN_DIR:-$HOME/vulcan}"

echo "Project Vulcan Uninstall"
echo ""
echo "This will:"
echo "  1. Stop and remove Vulcan containers"
echo "  2. Optionally remove Docker volumes and data"
echo ""

if [ ! -d "$INSTALL_DIR" ]; then
    echo "Error: Vulcan not found at $INSTALL_DIR"
    echo "Nothing to uninstall."
    exit 1
fi

cd "$INSTALL_DIR"

printf "Remove data directory ($INSTALL_DIR/data)? [y/N]: "
read -r REMOVE_DATA

printf "Remove workspace directory ($INSTALL_DIR/workspace)? [y/N]: "
read -r REMOVE_WORKSPACE

printf "Remove entire Vulcan directory ($INSTALL_DIR)? [y/N]: "
read -r REMOVE_ALL

echo ""
echo "Stopping containers..."
docker compose down

if [ "$REMOVE_DATA" = "y" ] || [ "$REMOVE_DATA" = "Y" ]; then
    docker compose down -v 2>/dev/null || true
    rm -rf "$INSTALL_DIR/data"
    echo "Data directory removed."
fi

if [ "$REMOVE_WORKSPACE" = "y" ] || [ "$REMOVE_WORKSPACE" = "Y" ]; then
    rm -rf "$INSTALL_DIR/workspace"
    echo "Workspace directory removed."
fi

if [ "$REMOVE_ALL" = "y" ] || [ "$REMOVE_ALL" = "Y" ]; then
    rm -rf "$INSTALL_DIR"
    echo "Vulcan directory removed."
fi

# Remove CLI wrapper
CLI_WRAPPER="$HOME/.local/bin/vulcan"
if [ -f "$CLI_WRAPPER" ]; then
    rm -f "$CLI_WRAPPER"
    echo "CLI wrapper removed."
fi

echo ""
echo "Project Vulcan has been uninstalled."
