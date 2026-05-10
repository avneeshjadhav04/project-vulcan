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
RUN apt-get update && apt-get install -y ca-certificates wget libssl3 proot && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create data directory with open permissions for SQLite
RUN mkdir -p /data && chmod 777 /data

# Create workspace directory for sandbox bind-mount
RUN mkdir -p /app/workspace && chmod 777 /app/workspace

# Download and extract Ubuntu 24.04 LTS rootfs for proot sandbox
# The exact patch version changes over time; we try the latest known release
RUN wget -q -O /tmp/ubuntu-rootfs.tar.gz https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.4-base-amd64.tar.gz \
    || wget -q -O /tmp/ubuntu-rootfs.tar.gz https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-amd64.tar.gz \
    && mkdir -p /app/ubuntu-rootfs \
    && tar -xzf /tmp/ubuntu-rootfs.tar.gz -C /app/ubuntu-rootfs \
    && rm /tmp/ubuntu-rootfs.tar.gz

# Copy API binary
COPY --from=api-builder /app/api/target/release/api /usr/local/bin/api

# Copy built frontend assets
COPY --from=web-builder /app/web/dist ./dist

# Entrypoint script ensures /data is writable at runtime
# (Render disk mounts happen at runtime, overriding build-time directory)
RUN printf '#!/bin/sh\nset -e\nmkdir -p /data\nchmod 777 /data\nls -ld /data\nexec "$@"\n' > /entrypoint.sh && chmod +x /entrypoint.sh

ENV RUST_LOG=info

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:${PORT:-8080}/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["api"]
