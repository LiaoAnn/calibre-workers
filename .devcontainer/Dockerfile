FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie

RUN apt-get update \
  && apt-get install -y --no-install-recommends socat \
  && rm -rf /var/lib/apt/lists/*
