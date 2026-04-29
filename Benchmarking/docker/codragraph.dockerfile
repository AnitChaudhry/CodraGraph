# Codragraph CLI image — builds the workspace, exposes `npx codragraph`.

FROM node:22-bookworm-slim AS builder

# Native build tools needed for tree-sitter postinstall scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/thinqmesh-codra

# Copy lockfile and package configs first (cache-friendly layer)
COPY package.json package-lock.json ./
COPY codragraph/package.json codragraph/package.json
COPY codragraph-shared/package.json codragraph-shared/package.json
COPY codragraph-harness/package.json codragraph-harness/package.json
COPY codragraph-compress/package.json codragraph-compress/package.json
COPY codragraph-sdk/package.json codragraph-sdk/package.json
COPY codragraph-graphstore/package.json codragraph-graphstore/package.json

# Install (skip prepare/postinstall for now; we run them after copying source)
RUN npm install --no-audit --no-fund --ignore-scripts

# Copy source
COPY codragraph codragraph
COPY codragraph-shared codragraph-shared
COPY codragraph-harness codragraph-harness
COPY codragraph-compress codragraph-compress
COPY codragraph-sdk codragraph-sdk
COPY codragraph-graphstore codragraph-graphstore

# Build everything
RUN cd codragraph-shared && npm run build
RUN cd codragraph && npm run build
RUN cd codragraph-harness && npm run build
RUN cd codragraph-compress && npm run build
RUN cd codragraph-sdk && npm run build

# --- Runtime image ---
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/thinqmesh-codra
COPY --from=builder /workspace/thinqmesh-codra ./

# Make codragraph CLI available on PATH
RUN ln -s /workspace/thinqmesh-codra/codragraph/dist/cli/index.js /usr/local/bin/codragraph \
    && chmod +x /usr/local/bin/codragraph

ENTRYPOINT []
