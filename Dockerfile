# Multi-stage build: Frontend -> API -> Runtime

# Stage 1: Build React frontend
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Rust API
FROM ubuntu:24.04 AS api-builder
RUN apt-get update && apt-get install -y curl pkg-config libssl-dev g++ \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /app/api
COPY api/Cargo.toml api/Cargo.lock ./
COPY api/src ./src
COPY db/migrations /app/db/migrations
RUN cargo build --release

# Stage 3: Runtime
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y ca-certificates wget libssl3 proot chromium libstdc++6 python3 python3-pip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create data directory with open permissions for SQLite
RUN mkdir -p /data && chmod 777 /data

# Create workspace directory for sandbox bind-mount
RUN mkdir -p /app/workspace && chmod 755 /app/workspace

# Download and extract Ubuntu 24.04 LTS rootfs for proot sandbox
# TARGETARCH is automatically set by Docker buildx for multi-arch builds
ARG TARGETARCH
RUN ARCH=${TARGETARCH:-amd64} \
    && wget -q -O /tmp/ubuntu-rootfs.tar.gz https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.4-base-${ARCH}.tar.gz \
    || wget -q -O /tmp/ubuntu-rootfs.tar.gz https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-${ARCH}.tar.gz \
    && mkdir -p /app/ubuntu-rootfs \
    && tar -xzf /tmp/ubuntu-rootfs.tar.gz -C /app/ubuntu-rootfs \
    && rm /tmp/ubuntu-rootfs.tar.gz

# Pre-install common dev tools into the rootfs so AI agents don't have to apt-get every time
RUN proot -0 -R /app/ubuntu-rootfs -b /etc/resolv.conf:/etc/resolv.conf /bin/bash -c '\
    export DEBIAN_FRONTEND=noninteractive; \
    sed -i "s/Components: main/Components: main universe/" /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || sed -i "s/main restricted/main restricted universe/" /etc/apt/sources.list 2>/dev/null || true; \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        nodejs npm \
        git curl wget ca-certificates \
        build-essential gcc g++ make \
        libffi-dev libssl-dev python3-dev zlib1g-dev \
        file unzip xz-utils \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*'

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
