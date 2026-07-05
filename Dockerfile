# syntax=docker/dockerfile:1

# Multi-stage build: Frontend -> API -> proot -> Runtime

# Stage 1: Build React frontend
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Rust API
FROM ubuntu:24.04 AS api-builder
RUN apt-get update && apt-get install -y curl pkg-config libssl-dev g++ unzip wget \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Vosk C library for linking
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ] || [ -z "$TARGETARCH" ]; then \
        wget -q https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-linux-x86_64-0.3.45.zip \
        && unzip -q vosk-linux-x86_64-0.3.45.zip \
        && cp vosk-linux-x86_64-0.3.45/libvosk.so /usr/local/lib/ \
        && ldconfig \
        && rm -rf vosk-linux-x86_64-0.3.45*; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        wget -q https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-linux-aarch64-0.3.45.zip \
        && unzip -q vosk-linux-aarch64-0.3.45.zip \
        && cp vosk-linux-aarch64-0.3.45/libvosk.so /usr/local/lib/ \
        && ldconfig \
        && rm -rf vosk-linux-aarch64-0.3.45*; \
    fi

# Ensure linker can find libvosk during compilation
ENV LIBRARY_PATH=/usr/local/lib

WORKDIR /app/api
COPY api/Cargo.toml api/Cargo.lock ./
COPY api/src ./src
COPY db/migrations /app/db/migrations
# Retry crate downloads up to 5 times and allow 120s per request so transient
# crates.io edge timeouts (Varnish cache 503s) don't fail the build.
ENV CARGO_NET_RETRY=5
ENV CARGO_HTTP_TIMEOUT=120
RUN cargo build --release

# Stage 3: Build proot v5.4.0 from source
# Ubuntu 24.04's apt proot (5.1.0) segfaults on arm64 kernel 6.17+.
# Building v5.4.0 statically produces a portable binary for both arches.
FROM ubuntu:24.04 AS proot-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkg-config git ca-certificates \
        libtalloc-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --recursive -b v5.4.0 https://github.com/proot-me/proot /proot-src
WORKDIR /proot-src
RUN LDFLAGS="-static" make -C src proot GIT=false

# Stage 4: Runtime
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y ca-certificates wget libssl3 chromium libstdc++6 python3 python3-pip unzip curl && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS (NodeSource) so MCP stdio servers spawned by the API
# host (e.g. `npx -y @modelcontextprotocol/server-*`) can run. Version matches
# the web-builder stage for parity.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install proot v5.4.0 (built from source in proot-builder stage)
COPY --from=proot-builder /proot-src/src/proot /usr/local/bin/proot

WORKDIR /app

# Create data directory with open permissions for SQLite and npm cache
RUN mkdir -p /data && chmod 777 /data

# Persist the npm/npx cache alongside the SQLite DB on the /data volume so
# `npx -y <pkg>` downloads survive container restarts on any deployment.
ENV npm_config_cache=/data/.npm
RUN mkdir -p /data/.npm && chmod 777 /data/.npm

# Create workspace directory for sandbox bind-mount
RUN mkdir -p /app/workspace && chmod 755 /app/workspace

# Install Vosk C library for runtime
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ] || [ -z "$TARGETARCH" ]; then \
        wget -q https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-linux-x86_64-0.3.45.zip \
        && unzip -q vosk-linux-x86_64-0.3.45.zip \
        && cp vosk-linux-x86_64-0.3.45/libvosk.so /usr/local/lib/ \
        && ldconfig \
        && rm -rf vosk-linux-x86_64-0.3.45*; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        wget -q https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-linux-aarch64-0.3.45.zip \
        && unzip -q vosk-linux-aarch64-0.3.45.zip \
        && cp vosk-linux-aarch64-0.3.45/libvosk.so /usr/local/lib/ \
        && ldconfig \
        && rm -rf vosk-linux-aarch64-0.3.45*; \
    fi

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
        sudo \
        libffi-dev libssl-dev python3-dev zlib1g-dev \
        file unzip xz-utils \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*'

# Vulcan shell prompt.
# The API spawns bash with --norc -i so no rootfs rc files are sourced; the
# prompt and OSC cwd reporting are driven entirely by PS1/PROMPT_COMMAND
# environment variables set by the Rust code. This avoids fighting Ubuntu's
# default rc files and any BuildKit/heredoc compatibility issues.

# Create a real 'vulcan' user in the rootfs. The sandbox shell will run as this
# user instead of root so the prompt prefix reflects the actual identity, and it
# still has passwordless sudo for operations that need elevated privileges.
RUN proot -0 -R /app/ubuntu-rootfs -b /etc/resolv.conf:/etc/resolv.conf /bin/bash -c '\
    useradd -m -s /bin/bash -G sudo vulcan && \
    echo "vulcan ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vulcan && \
    chmod 0440 /etc/sudoers.d/vulcan'

# Install a minimal Vulcan shell configuration for the vulcan user. The API spawns
# bash with --rcfile pointing at this file, so it runs instead of any default
# Ubuntu bashrc. This sets the prompt, OSC cwd reporting, and basic readline
# behavior without fighting login-shell environment resets from /bin/su.
COPY scripts/vulcan_bashrc /tmp/vulcan_bashrc
RUN proot -0 -R /app/ubuntu-rootfs -b /etc/resolv.conf:/etc/resolv.conf /bin/bash -c '\
    cp /tmp/vulcan_bashrc /home/vulcan/.vulcan_bashrc && \
    chown vulcan:vulcan /home/vulcan/.vulcan_bashrc && \
    chmod 644 /home/vulcan/.vulcan_bashrc'

# Download Vosk model (40MB small English model)
RUN mkdir -p /models/vosk \
    && wget -q -O /tmp/vosk-model.zip \
       https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip \
    && unzip -q /tmp/vosk-model.zip -d /tmp \
    && mv /tmp/vosk-model-small-en-us-0.15/* /models/vosk/ \
    && rm -rf /tmp/vosk-model.zip /tmp/vosk-model-small-en-us-0.15 \
    && echo "Vosk model installed at /models/vosk"

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
