#!/usr/bin/env bash
# Pre-push CI simulation. Runs the full GitHub Actions CI chain inside
# a Linux Docker container so platform-specific drift (Windows-only
# lockfile entries, npm ci differences, etc.) is caught BEFORE pushing.
#
# Usage:  bash scripts/preflight.sh
# Exit 0 = safe to push. Non-zero = fix locally first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "── pre-push: simulating CI in node:22-bookworm ──"
echo "REPO: $REPO_ROOT"
echo

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$REPO_ROOT:/src:ro" \
  -w /work \
  node:22-bookworm \
  bash -e -c '
set -euo pipefail
echo "── 1/6 prepare workspace ──"
apt-get update -qq && apt-get install -y -qq rsync >/dev/null 2>&1
rsync -a --exclude=node_modules --exclude=dist --exclude=.git --exclude=tsconfig.tsbuildinfo /src/ /work/

echo "── 2/6 npm ci (strict, like CI) ──"
npm ci --include=optional 2>&1 | tail -5

echo "── 3/6 format:check ──"
npm run format:check 2>&1 | tail -3

echo "── 4/6 lint ──"
npm run lint 2>&1 | tail -3

echo "── 5/6 build all packages in dep order ──"
for pkg in @codragraph/shared @codragraph/graphstore @codragraph/cli @codragraph/harness @codragraph/compress @codragraph/sdk @codragraph/org; do
  echo "  $pkg"
  npm run build --workspace "$pkg" 2>&1 | tail -1
done

echo "── 6/6 tests for graphstore + harness + org ──"
npm test --workspace @codragraph/graphstore 2>&1 | tail -3
npm test --workspace @codragraph/harness 2>&1 | tail -3
npm test --workspace @codragraph/org 2>&1 | tail -3

echo
echo "✓ ALL CHECKS PASSED — safe to push"
'
