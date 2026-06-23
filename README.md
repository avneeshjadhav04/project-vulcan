# Project Vulcan

A personal, secure AI assistant platform built with Rust, React, and multi-provider LLM support.

![Tech Stack](https://img.shields.io/badge/Rust-1.90+-orange?logo=rust)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)

## Features

- **AI Chat**: Real-time streaming responses with Markdown rendering, Shiki syntax highlighting, message editing, regeneration, reactions, and file attachments
- **Multi-Provider Models**: Bring your own keys for NVIDIA NIM, OpenAI, Groq, Anthropic, Ollama, OpenRouter, Together AI, or any OpenAI-compatible provider
- **AI Agent & Tools**: Sandboxed terminal, file create/read/modify, Python execution, web search/fetch, scratchpad, and Google Calendar/Gmail/Todoist integrations — with per-tool permissions (auto/ask/deny)
- **Memory & Context**: Conversation summarization, opt-in cross-chat memory, and a persistent scratchpad the AI can read and update
- **Workspace & Files**: User workspace file tree with upload/download, AI-generated artifact previews, and chat export to Markdown or JSON
- **Sandboxed Terminal**: WebSocket terminal running commands inside an isolated Ubuntu/proot environment
- **Integrations**: OAuth connections to Google (Calendar + Gmail) and Todoist
- **Organization**: Pin, archive, folder, and tag chats; command palette; global chat search; and a usage dashboard
- **Voice Input**: Browser microphone transcription via Vosk
- **Accessible & Themed**: Dark/light/system theme, resizable panels, keyboard shortcuts (`Ctrl + `` for terminal), ARIA labels, and focus rings

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
| `APP_BASE_URL` | No | `http://localhost:8765` | Base URL for OAuth callbacks |
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

