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
| Database | SQLite (embedded, zero-config) |
| Proxy | Caddy |
| AI | NVIDIA NIM (BYOK) |

## Deploy on Render

### Step 1: Create Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub repo (`avneeshjadhav04/ai-assistant`)
4. Name: `carbon-ai`
5. Region: Choose your preferred region
6. Branch: `main`
7. Runtime: **Docker**
8. Plan: Free (or Starter for better performance)
9. Click **Create Web Service**

### Step 2: Add Disk (Persistent Storage)

SQLite requires persistent storage or data will be lost on redeploy.

1. In your service dashboard, go to **Disks** tab
2. Click **Add Disk**
3. Name: `carbon-ai-data`
4. Mount Path: `/data`
5. Size: 1 GB (minimum)
6. Click **Create**

> **Note:** Free plan does not support disks. Upgrade to Starter ($7/month) or use Docker Compose for local deployment.

### Step 3: Set Environment Variables

Go to **Environment** tab and add:

| Key | Value | Notes |
|-----|-------|-------|
| `MASTER_KEY` | `your-32-byte-secret-key-here!!!` | Generate a random 32+ character string |
| `ADMIN_DEFAULT_EMAIL` | `admin@local.local` | Default admin login |
| `ADMIN_DEFAULT_PASSWORD` | `your-secure-admin-password` | Change this after first login |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |

The `DATABASE_URL` is already set in the Dockerfile to `sqlite:/data/carbon_ai.db` which will use the mounted disk.

Click **Save Changes**.

### Step 4: Deploy

1. Click **Manual Deploy** → **Deploy latest commit**
2. Wait for the build to complete (3-5 minutes)
3. Your app will be live at the service URL

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

# 2. Generate JWT keys (optional, falls back to HS256)
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
# Terminal 1: API
cd api && cargo run

# Terminal 2: Sandbox (requires root/CAP_SYS_ADMIN)
cd sandbox && cargo run

# Terminal 3: Frontend
cd web && npm install && npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | No | `sqlite:./carbon_ai.db` | SQLite database file path |
| `MASTER_KEY` | Yes | - | 32+ byte key for AES-256-GCM encryption |
| `ADMIN_DEFAULT_EMAIL` | No | `admin@local.local` | Default admin login |
| `ADMIN_DEFAULT_PASSWORD` | Yes | - | Default admin password |
| `NIM_BASE_URL` | No | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |
| `JWT_SECRET_PATH` | No | - | Path to RSA private key (auto-fallbacks to HS256) |
| `PORT` | No | `8080` | HTTP port (Render auto-sets this) |

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
                   │   SQLite    │    │ NVIDIA NIM  │    │  Sandbox    │
                   │  (file DB)  │    │   (AI API)  │    │  (nsjail)   │
                   └─────────────┘    └─────────────┘    └─────────────┘
```

## License

MIT
