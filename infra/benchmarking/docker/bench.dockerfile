# Bench-script image — runs the TS benchmark scripts under tsx.

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/thinqmesh-codra

# Copy the entire monorepo — bench scripts depend on codragraph-harness etc. as
# workspace deps. The volumes in docker-compose.yaml mount fresh source over this.
COPY package.json package-lock.json ./
COPY codragraph-shared codragraph-shared
COPY codragraph codragraph
COPY codragraph-harness codragraph-harness
COPY codragraph-compress codragraph-compress
COPY codragraph-sdk codragraph-sdk
COPY codragraph-graphstore codragraph-graphstore
COPY Benchmarking Benchmarking

# Workspace install (the Benchmarking/scripts/package.json is its own workspace package
# OR depends on the monorepo via file: refs — see scripts/package.json)
RUN npm install --no-audit --no-fund --ignore-scripts

# Build the deps the bench scripts use
RUN cd codragraph-shared && npm run build || true
RUN cd codragraph && npm run build || true
RUN cd codragraph-harness && npm run build || true

WORKDIR /workspace/thinqmesh-codra/Benchmarking/scripts

# Default: idle so docker compose run --rm bench <cmd> works
CMD ["sleep", "infinity"]
