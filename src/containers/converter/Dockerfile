# syntax=docker/dockerfile:1

# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS builder

WORKDIR /app

# Skip checksum DB lookup and use direct module fetch to avoid proxy timeouts
ENV GONOSUMDB=* \
  GOPROXY=direct

# Copy module metadata first for layer caching
COPY go.mod go.sum ./

# Resolve dependencies from locked go.mod/go.sum
RUN go mod download

# Copy source after dependency layer
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux GOFLAGS=-mod=readonly go build -trimpath -ldflags="-s -w" -o converter .

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# ca-certificates needed for any outbound TLS (future use)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates calibre \
  && rm -rf /var/lib/apt/lists/*

ENV QT_QPA_PLATFORM=offscreen

COPY --from=builder /app/converter /usr/local/bin/converter

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/converter"]
