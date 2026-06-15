# Project Vulcan

A personal, secure AI assistant platform built with Rust, React, and multi-provider LLM support.

![License](https://img.shields.io/badge/License-MIT-green.svg)
![Tech Stack](https://img.shields.io/badge/Rust-1.90+-orange?logo=rust)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![Platforms](https://img.shields.io/badge/Platforms-linux%2Famd64%2C%20linux%2Farm64-blue)

## Features

- **AI Chat**: Real-time streaming chat with Server-Sent Events (SSE), smooth stream handoff, and live typing indicators
- **Multi-Provider Support**: NVIDIA NIM, OpenAI, Groq, and any OpenAI-compatible provider — bring your own keys
- **Syntax Highlighting**: Code blocks rendered with Shiki (`github-dark` theme) for 100+ languages
- **Sandboxed Terminal**: Isolated command execution via `proot` + Ubuntu 24.04 LTS rootfs
- **Mobile-First UX**: Responsive design with action buttons always visible, smart auto-scroll, and keyboard-friendly navigation
- **Accessible**: ARIA labels, `aria-live` regions, focus rings, and keyboard navigation throughout
- **Dark Mode Aesthetic**: IBM Plex fonts, strict dark mode, glassmorphism effects, smooth animations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, TanStack Query, Shiki |
| **Backend API** | Rust (Axum, Tokio, SQLx) |
| **Sandbox** | `proot` + Ubuntu 24.04 LTS rootfs |
| **Database** | SQLite (embedded, zero-config) with FTS5 search |
| **AI Providers** | NVIDIA NIM, OpenAI, Groq, OpenAI-compatible (BYOK) |

## Quick Start (Docker)

The fastest way to run Vulcan on any machine with Docker.

### Option A: One-Liner Install

**Linux / macOS / WSL:**
```bash
curl -fsSL https://raw.githubusercontent.com/avneeshjadhav04/project-vulcan/main/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/avneeshjadhav04/project-vulcan/main/scripts/install.ps1 | iex
```

This will:
- Check for Docker and Docker Compose
- Create `~/vulcan/` with persistent data and workspace directories
- Generate a secure `MASTER_KEY` in `.env`
- Pull the latest multi-arch image from GHCR
- Start Vulcan on [http://localhost:8080](http://localhost:8080)
- Add a `vulcan` CLI command for start/stop/update/logs/uninstall

### Option B: Manual Docker Compose

For users who prefer to see exactly what is running:

```bash
# 1. Create a directory
mkdir ~/vulcan && cd ~/vulcan

# 2. Download compose file
curl -O https://raw.githubusercontent.com/avneeshjadhav04/project-vulcan/main/docker-compose.yml

# 3. Generate .env with a secure master key
if command -v openssl >/dev/null 2>&1; then
  echo "MASTER_KEY=$(openssl rand -hex 32)" > .env
else
  echo "MASTER_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" > .env
fi

# 4. Start
docker compose up -d
```

### Option C: Quick Test (Ephemeral)

Just want to try it for a few minutes without persistence?

```bash
docker run -p 8080:8080 \
  -e "MASTER_KEY=$(openssl rand -hex 32)" \
  -v vulcan_data:/data \
  ghcr.io/avneeshjadhav04/project-vulcan:latest
```

**Note:** Data lives in a Docker volume. Fine for testing, not for long-term use.

## Post-Install

1. Open [http://localhost:8080](http://localhost:8080)
2. Sign up for a new account
3. Go to **Settings** and add your AI provider API key(s)
4. Start chatting

## CLI Commands (after install)

```bash
vulcan start       # Start Vulcan
vulcan stop        # Stop Vulcan
vulcan update      # Pull latest image and restart
vulcan logs        # View logs
vulcan status      # Check container status
vulcan uninstall   # Remove Vulcan
```

## Updating

Vulcan auto-pulls the latest image on every `vulcan start`. To force an immediate update:

```bash
vulcan update
```

Or manually:
```bash
cd ~/vulcan && docker compose pull && docker compose up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MASTER_KEY` | Yes | auto-generated | 32+ byte key for AES-256-GCM encryption |
| `DATABASE_URL` | No | `sqlite:/data/vulcan.db` | SQLite database path |
| `NIM_BASE_URL` | No | `https://integrate.api.nvidia.com/v1` | Default NVIDIA NIM endpoint |
| `APP_BASE_URL` | No | `http://localhost:8080` | Base URL for OAuth callbacks |
| `PORT` | No | `8080` | HTTP port |
| `DISABLE_TOOLS` | No | - | Set to `1` to disable AI tool execution |

> **Security Warning:** Never share or commit your `MASTER_KEY`. It is used to encrypt all stored API keys and credentials.

## Development

### Option A: Docker Compose (from source)

```bash
git clone https://github.com/avneeshjadhav04/project-vulcan.git
cd project-vulcan
cp .env.example .env
# Edit .env with a secure MASTER_KEY
docker compose -f docker-compose.dev.yml up --build
```

### Option B: Without Docker

```bash
# Terminal 1: API
cd api && cargo run

# Terminal 2: Frontend
cd web && npm install && npm run dev
```

## Security

- **Passwords**: Argon2id hashing
- **API Keys**: AES-256-GCM encryption at rest
- **Auth**: JWT via HttpOnly, SameSite=Strict cookies with CSRF tokens
- **Terminal**: `proot` with Ubuntu 24.04 rootfs (filesystem isolation, no privileges required)
- **JWT Fallback**: HS256 when RSA keys not available

## Branching Strategy

- **`main`**: Production-ready code.
- **`develop`**: Active development branch.

All new features and bug fixes should target `develop` first.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request targeting **`develop`**

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
