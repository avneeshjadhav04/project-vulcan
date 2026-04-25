# Carbon AI Assistant - Agent Guide

## Overview
Full-stack SaaS personal AI assistant platform.
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS (Carbon aesthetic)
- **Backend API**: Rust (Axum, Tokio, SQLx)
- **Sandbox Executor**: Rust (Axum) + nsjail
- **Database**: SQLite (embedded, zero-config)
- **AI Provider**: NVIDIA NIM (BYOK - Bring Your Own Key)

## Quick Start

1. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with secure passwords and master key
   # Generate JWT keys (optional, falls back to HS256):
   mkdir -p secrets
   openssl genrsa -out secrets/jwt_private.pem 2048
   openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_private.pem.pub
   ```

2. **Run with Docker Compose**
   ```bash
   docker compose up --build
   ```
   - API + Frontend: `:8080`
   - Default admin: `admin@local.local` / password from `.env`

3. **Local Dev (without Docker)**
   - `cd api && cargo run`
   - `cd sandbox && cargo run` (requires root/CAP_SYS_ADMIN for nsjail)
   - `cd web && npm install && npm run dev`

## Architecture

| Service | Port | Notes |
|---------|------|-------|
| `api` | `8080` | Axum gateway, serves static frontend, auth, chat SSE, admin, WS proxy to sandbox |
| `sandbox` | internal `8081` | Privileged container, spawns nsjail for terminal commands |

## Key Conventions

- **Auth**: JWT via HttpOnly cookie (`token`). RS256 with RSA keys in `./secrets/`, or HS256 fallback.
- **BYOK Encryption**: User NVIDIA NIM keys encrypted with AES-256-GCM using `MASTER_KEY` (hashed to 32 bytes).
- **Terminal**: WebSocket `/api/terminal` -> API proxies to Sandbox WS. Sandbox runs commands via nsjail with resource limits (512MB RAM, 30s CPU, no network).
- **Chat SSE**: `POST /api/chats/:id/message` returns SSE stream. Frontend uses `fetch` + `ReadableStream` to read chunks.
- **Models**: Cached for 5 minutes from NVIDIA NIM `/v1/models` endpoint.
- **Admin**: Simple role-based access (`role = 'admin'`). Admin dashboard at `/admin`.

## Database Schema
- `users` (id, email, password_hash, encrypted_nim_key, role)
- `chats` (id, user_id, title, model_id)
- `messages` (id, chat_id, role, content, tokens_used)
- `terminal_sessions` (id, user_id, command, status, stdout, stderr)

## Important Notes
- Never commit `.env` or `secrets/`.
- The `sandbox` container **must** run privileged for nsjail namespaces.
- API auto-creates the admin user on startup if it doesn't exist.
- Frontend uses IBM Plex Sans/Mono fonts. Strict dark mode palette (`#161616` background).
- SQLite database file is created automatically at startup (path configurable via `DATABASE_URL`).
