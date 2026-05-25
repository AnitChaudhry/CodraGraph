# Bench-script image — runs the TS benchmark scripts under tsx.

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/thinqmesh-codragraph

# Copy the entire monorepo — bench scripts depend on codragraph-harness etc. as
# workspace deps. The volumes in docker-compose.yaml mount fresh source over this.
COPY package.json package-lock.json ./
COPY packages packages
COPY apps/web apps/web
COPY integrations integrations
COPY infra/benchmarking infra/benchmarking

# Workspace install (the infra/benchmarking/scripts/package.json is its own package
# OR depends on the monorepo via file: refs — see scripts/package.json)
RUN npm install --no-audit --no-fund --ignore-scripts

# Build the deps the bench scripts use
RUN npm run build --workspace @codragraph/shared || true
RUN npm run build --workspace @codragraph/graphstore || true
RUN npm run build --workspace @codragraph/cli || true
RUN npm run build --workspace @codragraph/harness || true

WORKDIR /workspace/thinqmesh-codragraph/infra/benchmarking/scripts

# Default: idle so docker compose run --rm bench <cmd> works
CMD ["sleep", "infinity"]
