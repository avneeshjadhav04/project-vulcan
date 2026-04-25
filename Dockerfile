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
RUN apt-get update && apt-get install -y ca-certificates wget libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy API binary
COPY --from=api-builder /app/api/target/release/api /usr/local/bin/api

# Copy built frontend assets
COPY --from=web-builder /app/web/dist ./dist

# Create startup script with wait logic
RUN cat > /usr/local/bin/start.sh << 'EOF'
#!/bin/sh
set -e

echo "[STARTUP] Carbon AI starting..."
echo "[STARTUP] Waiting for DATABASE_URL..."

# Wait up to 60 seconds for DATABASE_URL to be available (Render injects it after DB provisions)
for i in $(seq 1 60); do
    if [ -n "$DATABASE_URL" ]; then
        echo "[STARTUP] DATABASE_URL is set (attempt $i)"
        break
    fi
    echo "[STARTUP] DATABASE_URL not yet available, waiting... ($i/60)"
    sleep 2
done

if [ -z "$DATABASE_URL" ]; then
    echo "[STARTUP] ERROR: DATABASE_URL is still empty after 120 seconds."
    echo "[STARTUP] This usually means the Render database hasn't been provisioned yet."
    echo "[STARTUP] Please:"
    echo "[STARTUP]   1. Check that a PostgreSQL database exists in your Render dashboard"
    echo "[STARTUP]   2. Verify the database name matches 'carbon-ai-db'"
    echo "[STARTUP]   3. Redeploy the service after the database is active"
    exit 1
fi

echo "[STARTUP] Binary check:"
ls -la /usr/local/bin/api
echo "[STARTUP] Library check:"
ldd /usr/local/bin/api || true
echo "[STARTUP] Working dir: $(pwd)"
echo "[STARTUP] Port: $PORT"
echo "[STARTUP] Executing API..."
exec /usr/local/bin/api 2>&1
EOF
RUN chmod +x /usr/local/bin/start.sh

ENV RUST_LOG=info

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:${PORT:-8080}/api/health || exit 1

CMD ["/usr/local/bin/start.sh"]
