# Multi-stage build: Frontend -> API -> Runtime

# Stage 1: Build React frontend
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Rust API
FROM rust:1.90-slim-bookworm AS api-builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app/api
COPY api/Cargo.toml api/Cargo.lock ./
COPY api/src ./src
COPY db/migrations /app/db/migrations
RUN cargo build --release

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates wget libssl3 libc-bin && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy API binary
COPY --from=api-builder /app/api/target/release/api /usr/local/bin/api

# Copy built frontend assets
COPY --from=web-builder /app/web/dist ./dist

# Create startup script with diagnostics
RUN cat > /usr/local/bin/start.sh << 'EOF'
#!/bin/sh
set -e
echo "[STARTUP] Carbon AI starting..."
echo "[STARTUP] Binary location:"
ls -la /usr/local/bin/api
echo "[STARTUP] Library dependencies:"
ldd /usr/local/bin/api || true
echo "[STARTUP] Current directory: $(pwd)"
echo "[STARTUP] Files in cwd:"
ls -la
echo "[STARTUP] Environment:"
echo "PORT=$PORT"
echo "BIND_ADDR=$BIND_ADDR"
echo "DATABASE_URL=$(echo $DATABASE_URL | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/')"
echo "[STARTUP] Executing API..."
exec /usr/local/bin/api 2>&1
EOF
RUN chmod +x /usr/local/bin/start.sh

ENV RUST_LOG=info

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:${PORT:-8080}/api/health || exit 1

CMD ["/usr/local/bin/start.sh"]
