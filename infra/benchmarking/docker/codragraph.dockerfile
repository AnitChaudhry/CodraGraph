# CodraGraph CLI image — builds the workspace, exposes `codragraph` (the bin
# from `@codragraph/cli`). Inside the container the bin is symlinked into
# /usr/local/bin so you can call it directly: `docker compose run … codragraph …`.

FROM node:22-bookworm-slim AS builder

# Native build tools needed for tree-sitter postinstall scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/thinqmesh-codragraph

# Copy lockfile and package configs first (cache-friendly layer)
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/harness/package.json packages/harness/package.json
COPY packages/compress/package.json packages/compress/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/graphstore/package.json packages/graphstore/package.json
COPY packages/org/package.json packages/org/package.json
COPY apps/web/package.json apps/web/package.json
COPY integrations/claude/package.json integrations/claude/package.json
COPY integrations/codex/package.json integrations/codex/package.json

# Install (skip prepare/postinstall for now; we run them after copying source)
RUN npm install --no-audit --no-fund --ignore-scripts

# Copy source
COPY packages packages
COPY apps/web apps/web
COPY integrations integrations

# Build everything
RUN npm run build --workspace @codragraph/shared
RUN npm run build --workspace @codragraph/graphstore
RUN npm run build --workspace @codragraph/cli
RUN npm run build --workspace @codragraph/harness
RUN npm run build --workspace @codragraph/compress
RUN npm run build --workspace @codragraph/sdk
RUN npm run build --workspace @codragraph/org

# --- Runtime image ---
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/thinqmesh-codragraph
COPY --from=builder /workspace/thinqmesh-codragraph ./

# Make codragraph CLI available on PATH
RUN ln -s /workspace/thinqmesh-codragraph/packages/core/dist/cli/index.js /usr/local/bin/codragraph \
    && chmod +x /usr/local/bin/codragraph

ENTRYPOINT []
