# Project Vulcan

A personal, secure AI assistant platform built with Rust, React, and multi-provider LLM support.

![License](https://img.shields.io/badge/License-MIT-green.svg)
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

## Quick Deploy (Render)

### Step 1: Create Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub repo (`avneeshjadhav04/project-vulcan`)
4. Configure:
   - **Name**: `project-vulcan`
   - **Runtime**: Docker
   - **Plan**: Starter (for disk support)
5. Click **Create Web Service**

### Step 2: Add Persistent Disk

SQLite needs persistent storage:

1. Service dashboard → **Disks** tab → **Add Disk**
2. **Name**: `vulcan-data`
3. **Mount Path**: `/data`
4. **Size**: 1 GB
5. Click **Create**

> Free plan does not support disks. Use Starter plan or Docker Compose locally.

### Step 3: Set Environment Variables

Go to **Environment** tab:

| Key | Value | Description |
|-----|-------|-------------|
| `MASTER_KEY` | `your-32-byte-secret-key!!!` | Random 32+ character string for encryption |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | Default NVIDIA NIM endpoint |

`DATABASE_URL` defaults to `sqlite:/data/vulcan.db` (uses the mounted disk).

### Step 4: Deploy

1. Click **Manual Deploy** → **Deploy latest commit**
2. Wait 3–5 minutes for build
3. Your app is live!

### First Use

1. Open your Render service URL
2. Create an account via the signup page
3. Log in and add your AI provider API key(s) in Settings

> **Note:** The sandboxed terminal runs inside the API container via `proot`. No privileged mode required. Works on Render, VPS, and local Docker.

---

## Local Development

### Option A: Docker Compose (Full Features)

```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with secure values

# 2. Launch everything
docker compose up --build
```

- App: http://localhost:8080
- Create an account at `/signup`, then log in

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

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | No | `sqlite:./vulcan.db` | SQLite database path |
| `MASTER_KEY` | Yes | - | 32+ byte key for AES-256-GCM |
| `NIM_BASE_URL` | No | `https://integrate.api.nvidia.com/v1` | Default NVIDIA NIM endpoint |
| `JWT_SECRET_PATH` | No | - | RSA key path (falls back to HS256) |
| `PORT` | No | `8080` | HTTP port |
| `DISABLE_TOOLS` | No | - | Set to disable AI tool execution |

> **Security Warning:** Change default credentials before deploying publicly. Never commit `.env` or `secrets/` to version control.

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
│   │   │   │   ├── ChatHeader.tsx
│   │   │   │   ├── ChatMessages.tsx
│   │   │   │   ├── ChatInput.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── StreamingMessage.tsx
│   │   │   │   ├── CodeBlock.tsx         # Shiki syntax highlighting
│   │   │   │   ├── ToolExecutionCard.tsx
│   │   │   │   └── EmptyState.tsx
│   │   │   ├── ChatInterface.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Terminal.tsx
│   │   │   └── ProviderModelSelector.tsx
│   │   ├── hooks/          # Reusable logic
│   │   │   ├── useChatStream.ts    # Streaming state machine
│   │   │   ├── useVoiceInput.ts    # Speech recognition
│   │   │   ├── useChatScroll.ts    # Smart auto-scroll
│   │   │   └── useRelativeTime.ts  # Live timestamps
│   │   ├── stores/         # Zustand auth store
│   │   └── lib/            # API client
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── db/migrations/          # SQLite schema
├── secrets/                # JWT RSA keys (gitignored, local only)
├── logos/                  # Brand assets
├── docker-compose.yml      # Local orchestration
├── render.yaml             # Render Blueprint
├── Dockerfile              # Unified release build
├── .env.example            # Environment template
├── .gitignore              # Git exclusions
└── LICENSE                 # MIT License
```

## Branching Strategy

- **`main`**: Production-ready code. Deployed to Render.
- **`develop`**: Active development branch. Test here before merging to `main`.

All new features and bug fixes should target `develop` first.

## Security

- **Passwords**: Argon2id hashing
- **API Keys**: AES-256-GCM encryption at rest
- **Auth**: JWT via HttpOnly, SameSite=Strict cookies with CSRF tokens
- **Terminal**: `proot` with Ubuntu 24.04 rootfs (filesystem isolation, no privileges required)
- **JWT Fallback**: HS256 when RSA keys not available

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request targeting **`develop`**

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
