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

### Important: Database First!

Render deploys services and databases from `render.yaml` (Blueprint). However, the database may take 1-2 minutes to provision. If the web service starts before the database is ready, `DATABASE_URL` will be empty and the app will crash.

**Recommended deployment process:**

1. **Fork/clone this repo** to your GitHub account

2. **In Render Dashboard, create the database first:**
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click **New +** → **PostgreSQL**
   - Name it: `carbon-ai-db`
   - Region: Choose same region as your future web service
   - Plan: Free
   - Click **Create Database**
   - Wait until status shows **Available** (usually 1-2 minutes)

3. **Deploy the Blueprint:**
   - Click **New +** → **Blueprint**
   - Connect your GitHub repo (`avneeshjadhav04/ai-assistant`)
   - Render will read `render.yaml` and create the web service
   - The database `carbon-ai-db` should already exist and be auto-linked

4. **After deployment:**
   - Visit your service URL
   - Login: `admin@local.local`
   - Password: Check Render dashboard → `carbon-ai` service → Environment → `ADMIN_DEFAULT_PASSWORD`

### Troubleshooting Render Deploy

If you see `DATABASE_URL must be set` or `DATABASE_URL is empty`:
1. Verify `carbon-ai-db` PostgreSQL database exists and is **Available**
2. Go to your `carbon-ai` web service → Environment
3. Check that `DATABASE_URL` is populated with a connection string
4. If empty, manually copy the **Internal Connection String** from the database dashboard
5. Add it as an environment variable: `DATABASE_URL=<internal_connection_string>`
6. Click **Save Changes** and **Manual Deploy** → **Deploy latest commit**

> **Note:** The sandboxed terminal requires privileged containers and only works with Docker Compose. All other features (AI chat, model selection, BYOK, admin dashboard) work fully on Render.

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
| `PORT` | No | HTTP port (Render auto-sets this) |

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
