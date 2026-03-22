FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie

RUN apt-get update \
  && apt-get install -y --no-install-recommends socat calibre \
  && rm -rf /var/lib/apt/lists/*

ENV QT_QPA_PLATFORM=offscreen
