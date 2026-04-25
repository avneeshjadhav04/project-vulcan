FROM rust:1.90-slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app/api
COPY api/Cargo.toml api/Cargo.lock ./
COPY api/src ./src
COPY db/migrations ../db/migrations
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/api/target/release/api /usr/local/bin/api

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:8080/health || exit 1

CMD ["api"]
