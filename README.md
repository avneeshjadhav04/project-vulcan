# Project Vulcan

A personal, secure AI assistant platform built with Rust, React, and multi-provider LLM support.

![Tech Stack](https://img.shields.io/badge/Rust-1.90+-orange?logo=rust)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)

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

## Architecture

```
  CLIENT LAYER                    API LAYER                        DATA LAYER
  ┌─────────────────┐             ┌─────────────────┐              ┌─────────────────┐
  │                 │   HTTP/SSE  │                 │    SQLx      │                 │
  │  React + Vite   │◄───────────►│  Rust / Axum    │◄────────────►│     SQLite      │
  │  TypeScript     │   WebSocket │  Tokio async    │              │   (file DB)     │
  │  Tailwind CSS   │             │                 │              │   (FTS5 search) │
  └─────────────────┘             └────────┬────────┘              └─────────────────┘
                                           │
                           ┌───────────────┼───────────────┐
                           │               │               │
                           ▼               ▼               ▼
                    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
                    │  NVIDIA /   │  │   proot +   │  │  JWT /      │
                    │  OpenAI /   │  │ Ubuntu 24   │  │  Argon2     │
                    │  Groq / etc │  │  (Sandbox)  │  │  AES-GCM    │
                    │  (BYOK AI)  │  │             │  │             │
                    └─────────────┘  └─────────────┘  └─────────────┘
                     EXTERNAL            SANDBOX           SECURITY
```

## Security

- **Passwords**: Argon2id hashing
- **API Keys**: AES-256-GCM encryption at rest
- **Auth**: JWT via HttpOnly, SameSite=Strict cookies with CSRF tokens
- **Terminal**: `proot` with Ubuntu 24.04 rootfs (filesystem isolation, no privileges required)
- **JWT Fallback**: HS256 when RSA keys not available

## Project Structure

```
├── api/                    # Rust API Gateway (Axum)
│   ├── src/
│   │   ├── main.rs         # Server & routing
│   │   ├── auth.rs         # JWT, Argon2, AES-GCM
│   │   ├── config.rs       # Environment config
│   │   ├── db.rs           # SQLite connection
│   │   ├── middleware.rs   # Auth guards, CSRF
│   │   ├── models.rs       # Data types
│   │   ├── providers/      # Multi-provider registry
│   │   └── routes/
│   │       ├── auth.rs     # Login/signup
│   │       ├── chat.rs     # SSE streaming, tools, memory
│   │       ├── models.rs   # Provider model fetcher
│   │       └── terminal.rs # WS proxy
│   ├── Cargo.toml
│   └── Dockerfile
├── web/                    # React Frontend
│   ├── src/
│   │   ├── pages/          # Landing, Login, Chat, Settings
│   │   ├── components/
│   │   │   ├── chat/       # Chat UI sub-components
│   │   │   ├── ChatInterface.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Terminal.tsx
│   │   │   └── ProviderModelSelector.tsx
│   │   ├── hooks/          # Reusable logic
│   │   ├── stores/         # Zustand auth store
│   │   └── lib/            # API client
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── db/migrations/          # SQLite schema
├── secrets/                # JWT RSA keys (gitignored, local only)
├── logos/                  # Brand assets
├── docker-compose.dev.yml  # Development (build from source)
├── Dockerfile              # Unified release build
├── .env.example            # Environment template
├── .gitignore              # Git exclusions
```

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

