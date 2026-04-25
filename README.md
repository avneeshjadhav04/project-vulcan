# Carbon AI Assistant

Full-stack SaaS personal AI assistant platform with a sleek Carbon Design System aesthetic.

## Features

- **AI Chat**: Real-time streaming chat with NVIDIA NIM models
- **Model Selection**: Dynamic dropdown with latest available models
- **Bring Your Own Key**: Secure AES-256-GCM encrypted API key storage
- **Sandboxed Terminal**: Isolated command execution via nsjail (Docker Compose only)
- **Admin Dashboard**: User management and terminal audit logs
- **Carbon Aesthetic**: IBM Plex fonts, strict dark mode, minimal UI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Backend | Rust (Axum, Tokio, SQLx) |
| Sandbox | Rust (Axum) + nsjail |
| Database | PostgreSQL 16 |
| Proxy | Caddy |
| AI | NVIDIA NIM (BYOK) |

## Deploy on Render

1. Fork/clone this repo to your GitHub account
2. In Render Dashboard, click **New +** → **Blueprint**
3. Connect your GitHub repo
4. Render will read `render.yaml` and create:
   - A **Web Service** (`carbon-ai`) running the API + frontend
   - A **PostgreSQL database** (`carbon-ai-db`)
5. After deployment, visit your service URL and log in with:
   - **Email**: `admin@local.local`
   - **Password**: Check Render dashboard → Environment Variables → `ADMIN_DEFAULT_PASSWORD`

> **Note**: The sandboxed terminal feature requires Docker Compose with privileged containers and is not available on Render. All other features (chat, model selection, BYOK, admin) work fully.

## Local Development (Docker Compose - Full Features)

```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with secure values

# 2. Generate JWT keys
mkdir -p secrets
openssl genrsa -out secrets/jwt_private.pem 2048
openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_private.pem.pub

# 3. Launch everything
docker compose up --build
```

- App: http://localhost
- Default admin: `admin@local.local` / password from `.env`

## Local Development (Without Docker)

```bash
# Terminal 1: PostgreSQL
# Start Postgres and run migrations in db/migrations/

# Terminal 2: API
cd api && cargo run

# Terminal 3: Sandbox (requires root/CAP_SYS_ADMIN)
cd sandbox && cargo run

# Terminal 4: Frontend
cd web && npm install && npm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `MASTER_KEY` | Yes | 32+ byte key for AES-256-GCM encryption |
| `ADMIN_DEFAULT_EMAIL` | No | Default admin email (default: admin@local.local) |
| `ADMIN_DEFAULT_PASSWORD` | Yes | Default admin password |
| `NIM_BASE_URL` | No | NVIDIA NIM endpoint (default: https://integrate.api.nvidia.com/v1) |
| `JWT_SECRET_PATH` | No | Path to RSA private key (auto-fallbacks to HS256) |

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │────▶│   Caddy     │────▶│  Rust API   │
│  Frontend   │     │   Proxy     │     │   (Axum)    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          │                    │                    │
                          ▼                    ▼                    ▼
                   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
                   │  PostgreSQL │    │ NVIDIA NIM  │    │  Sandbox    │
                   │   (chat DB) │    │   (AI API)  │    │  (nsjail)   │
                   └─────────────┘    └─────────────┘    └─────────────┘
```
