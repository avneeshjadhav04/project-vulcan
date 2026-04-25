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

### Step 1: Create PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **PostgreSQL**
3. Name it: `carbon-ai-db`
4. Database: `carbon_ai`
5. User: `carbon_ai`
6. Region: Choose your preferred region
7. Plan: Free
8. Click **Create Database**
9. Wait until status shows **Available**
10. Copy the **Internal Database URL** (looks like `postgres://carbon_ai:password@carbon-ai-db:5432/carbon_ai`)

### Step 2: Create Web Service

1. Click **New +** → **Web Service**
2. Connect your GitHub repo (`avneeshjadhav04/ai-assistant`)
3. Name: `carbon-ai`
4. Region: Same as your database
5. Branch: `main`
6. Runtime: **Docker**
7. Plan: Free (or Starter for better performance)
8. Click **Create Web Service**

### Step 3: Set Environment Variables

After the service is created, go to **Environment** tab and add:

| Key | Value | Notes |
|-----|-------|-------|
| `DATABASE_URL` | `postgres://carbon_ai:PASSWORD@carbon-ai-db:5432/carbon_ai` | Paste your **Internal Database URL** from Step 1 |
| `MASTER_KEY` | `your-32-byte-secret-key-here!!!` | Generate a random 32+ character string |
| `ADMIN_DEFAULT_EMAIL` | `admin@local.local` | Default admin login |
| `ADMIN_DEFAULT_PASSWORD` | `your-secure-admin-password` | Change this after first login |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |

Click **Save Changes**.

### Step 4: Deploy

1. Go to the service dashboard
2. Click **Manual Deploy** → **Deploy latest commit**
3. Wait for the build to complete (3-5 minutes)
4. Your app will be live at the service URL

### Step 5: First Login

- Visit your service URL
- Login: `admin@local.local`
- Password: The `ADMIN_DEFAULT_PASSWORD` you set

> **Note:** The sandboxed terminal requires privileged containers and only works with Docker Compose. All other features (AI chat, model selection, BYOK, admin dashboard) work fully on Render.

---

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

## License

MIT
