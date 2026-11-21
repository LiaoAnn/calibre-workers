FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie

RUN apt-get update \
  && apt-get install -y --no-install-recommends socat calibre \
  && rm -rf /var/lib/apt/lists/*

# Docker CLI and buildx for wrangler's container image builds; the daemon is the dind service.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

# Go for the converter (src/containers/converter). Not the devcontainers Go feature: it adds
# SYS_PTRACE and seccomp=unconfined (for a debugger).
COPY --from=golang:1-trixie /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:/home/node/go/bin:$PATH

ENV QT_QPA_PLATFORM=offscreen
