# Carbon AI Assistant

A production-ready, full-stack SaaS personal AI assistant platform built with Rust, React, and NVIDIA NIM. Features a sleek dark-mode UI inspired by IBM Carbon Design System.

![Tech Stack](https://img.shields.io/badge/Rust-1.90+-orange?logo=rust)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)

## Features

- **AI Chat**: Real-time streaming chat with NVIDIA NIM models via Server-Sent Events (SSE)
- **Model Selection**: Dynamic dropdown fetching the latest available models from NVIDIA NIM
- **Bring Your Own Key (BYOK)**: Secure AES-256-GCM encrypted API key storage
- **Sandboxed Terminal**: Isolated command execution via `nsjail` (Docker Compose only)
- **Admin Dashboard**: User management and terminal audit logs with role-based access
- **Landing Page**: Animated marketing page with feature showcase and terminal demo
- **Carbon Aesthetic**: IBM Plex fonts, strict dark mode, glassmorphism effects, smooth animations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion |
| **Backend API** | Rust (Axum, Tokio, SQLx) |
| **Sandbox** | Rust (Axum) + nsjail |
| **Database** | SQLite (embedded, zero-config) |
| **AI Provider** | NVIDIA NIM (BYOK) |

## Quick Deploy (Render)

### Step 1: Create Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub repo (`avneeshjadhav04/ai-assistant`)
4. Configure:
   - **Name**: `carbon-ai`
   - **Runtime**: Docker
   - **Plan**: Starter (for disk support)
5. Click **Create Web Service**

### Step 2: Add Persistent Disk

SQLite needs persistent storage:

1. Service dashboard → **Disks** tab → **Add Disk**
2. **Name**: `carbon-ai-data`
3. **Mount Path**: `/data`
4. **Size**: 1 GB
5. Click **Create**

> Free plan does not support disks. Use Starter plan or Docker Compose locally.

### Step 3: Set Environment Variables

Go to **Environment** tab:

| Key | Value | Description |
|-----|-------|-------------|
| `MASTER_KEY` | `your-32-byte-secret-key!!!` | Random 32+ character string for encryption |
| `ADMIN_DEFAULT_EMAIL` | `admin@local.local` | Default admin login |
| `ADMIN_DEFAULT_PASSWORD` | `your-secure-password` | Change after first login |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |

`DATABASE_URL` defaults to `sqlite:/data/carbon_ai.db` (uses the mounted disk).

### Step 4: Deploy

1. Click **Manual Deploy** → **Deploy latest commit**
2. Wait 3-5 minutes for build
3. Your app is live!

### First Login

- URL: Your Render service URL
- Email: `admin@local.local`
- Password: The `ADMIN_DEFAULT_PASSWORD` you set

> **Note:** The sandboxed terminal requires privileged containers (Docker Compose only). All other features work fully on Render.

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
- Default admin: `admin@local.local` / password from `.env`

### Option B: Without Docker

```bash
# Terminal 1: API
cd api && cargo run

# Terminal 2: Sandbox (requires root/CAP_SYS_ADMIN)
cd sandbox && cargo run

# Terminal 3: Frontend
cd web && npm install && npm run dev
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │────▶│  Rust API   │────▶│   SQLite    │
│  Frontend   │     │   (Axum)    │     │  (file DB)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌─────────┐ ┌──────────┐ ┌──────────┐
        │ Sandbox │ │ NVIDIA   │ │  Admin   │
        │(nsjail) │ │   NIM    │ │ Dashboard│
        └─────────┘ └──────────┘ └──────────┘
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | No | `sqlite:./carbon_ai.db` | SQLite database path |
| `MASTER_KEY` | Yes | - | 32+ byte key for AES-256-GCM |
| `ADMIN_DEFAULT_EMAIL` | No | `admin@local.local` | Admin login |
| `ADMIN_DEFAULT_PASSWORD` | Yes | - | Admin password |
| `NIM_BASE_URL` | No | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |
| `JWT_SECRET_PATH` | No | - | RSA key path (falls back to HS256) |
| `PORT` | No | `8080` | HTTP port |

## Project Structure

```
├── api/                    # Rust API Gateway (Axum)
│   ├── src/
│   │   ├── main.rs         # Server & routing
│   │   ├── auth.rs         # JWT, Argon2, AES-GCM
│   │   ├── config.rs       # Environment config
│   │   ├── db.rs           # SQLite connection
│   │   ├── middleware.rs   # Auth guards
│   │   ├── models.rs       # Data types
│   │   └── routes/
│   │       ├── auth.rs     # Login/signup
│   │       ├── chat.rs     # SSE streaming
│   │       ├── models.rs   # NIM model fetcher
│   │       ├── terminal.rs # WS proxy
│   │       └── admin.rs    # Admin endpoints
│   ├── Cargo.toml
│   └── Dockerfile
├── sandbox/                # Rust Sandbox Executor
│   ├── src/main.rs         # nsjail spawner
│   ├── nsjail.cfg          # Jail config
│   ├── Cargo.toml
│   └── Dockerfile
├── web/                    # React Frontend
│   ├── src/
│   │   ├── pages/          # Landing, Login, Chat, Admin
│   │   ├── components/     # ChatInterface, Terminal, etc.
│   │   ├── stores/         # Zustand auth store
│   │   └── lib/            # API client
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── db/migrations/          # SQLite schema
├── docker-compose.yml      # Local orchestration
├── render.yaml             # Render Blueprint
├── Dockerfile              # Unified production build
└── .env.example            # Environment template
```

## Security

- **Passwords**: Argon2id hashing
- **API Keys**: AES-256-GCM encryption at rest
- **Auth**: JWT via HttpOnly, SameSite=Strict cookies
- **Terminal**: nsjail sandbox (no network, RO filesystem, resource limits)
- **JWT Fallback**: HS256 when RSA keys not available
