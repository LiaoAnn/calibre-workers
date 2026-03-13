# syntax=docker/dockerfile:1

# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS builder

WORKDIR /app

# Skip checksum DB lookup — build environments often can't reach sum.golang.org
ENV GONOSUMDB=*

# Copy module definition first for layer caching, then source
COPY go.mod main.go ./

# go mod tidy resolves and pins all dependencies (generates go.sum)
RUN go mod tidy

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o converter .

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# ca-certificates needed for any outbound TLS (future use)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Future: install Calibre for mobi/azw3 conversion support
# RUN wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sh /dev/stdin \
#   && rm -rf /tmp/calibre-installer-cache
# ENV QT_QPA_PLATFORM=offscreen

COPY --from=builder /app/converter /usr/local/bin/converter

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/converter"]
