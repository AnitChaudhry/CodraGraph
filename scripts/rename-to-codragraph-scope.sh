#!/usr/bin/env bash
# One-shot rename to @codragraph/<short> npm scope.
#
# Renames package names in:
#   - workspace package.json files (NOT root — root's `workspaces` array
#     references DIRECTORY names that should stay unchanged)
#   - all *.ts / *.tsx / *.mjs / *.cjs / *.js source under workspace dirs
#
# The regex matches the package name only when bounded by quotes (start)
# and quote-or-slash (end), so file paths and URLs are NOT touched.
#
# Order matters: longer/prefixed names FIRST so plain `codragraph` rename
# at the end doesn't mangle them.

set -e
cd "$(dirname "$0")/.."

declare -a PAIRS=(
  "codragraph-shared|@codragraph/shared"
  "codragraph-graphstore|@codragraph/graphstore"
  "codragraph-harness|@codragraph/harness"
  "codragraph-compress|@codragraph/compress"
  "codragraph-sdk|@codragraph/sdk"
  "codragraph-org|@codragraph/org"
  "codragraph-claude-plugin|@codragraph/claude-plugin"
  "codragraph-codex-integration|@codragraph/codex"
  "codragraph-cursor-integration|@codragraph/cursor"
  # `codragraph` last so it doesn't eat any of the above.
  "codragraph|@codragraph/cli"
)

# codragraph-web is intentionally NOT renamed — it's `private: true` and
# not published; keeping the unscoped name avoids touching its hundreds
# of internal imports.

run_sed() {
  local old="$1"
  local new="$2"
  # The capture groups preserve the bounding chars (quote / slash).
  local pattern="(['\"\`])$old([\"'\`/])"
  local replacement="\\1$new\\2"

  # Source files in workspaces (not node_modules, dist, .git, coverage).
  find . -type f \
    \( -name "*.ts" -o -name "*.tsx" -o -name "*.mjs" -o -name "*.cjs" -o -name "*.js" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/dist/*" \
    -not -path "*/.git/*" \
    -not -path "*/coverage/*" \
    -not -path "*/.codragraph/*" \
    -not -path "*/.history/*" \
    -exec sed -i -E "s|$pattern|$replacement|g" {} \;

  # Workspace package.json files (excluding root + node_modules).
  find . -mindepth 2 -maxdepth 2 -name "package.json" \
    -not -path "*/node_modules/*" \
    -exec sed -i -E "s|$pattern|$replacement|g" {} \;
}

for pair in "${PAIRS[@]}"; do
  IFS='|' read -r old new <<< "$pair"
  echo ">> rename $old -> $new"
  run_sed "$old" "$new"
done

echo ""
echo "Done. Verify with:"
echo "  grep -rE \"codragraph-(shared|graphstore|harness|compress|sdk|org|claude-plugin|codex|cursor)\" --include='*.ts' --include='*.tsx' --include='package.json' . | grep -v node_modules | grep -v dist | head"
