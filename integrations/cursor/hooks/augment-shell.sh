#!/bin/bash
# CodraGraph beforeShellExecution hook for Cursor
# Receives JSON on stdin with { command, cwd, timeout }
# Returns JSON on stdout with { permission, agent_message }
#
# Extracts search pattern from grep/rg commands, runs codragraph augment,
# and injects the enriched context via agent_message.

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | jq -r '.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ]; then
  echo '{"permission":"allow"}'
  exit 0
fi

# Skip non-search commands
case "$COMMAND" in
  cd\ *|npm\ *|yarn\ *|pnpm\ *|git\ commit*|git\ push*|git\ pull*|mkdir\ *|rm\ *|cp\ *|mv\ *|echo\ *|cat\ *)
    echo '{"permission":"allow"}'
    exit 0
    ;;
esac

# Extract search pattern from rg/grep commands
PATTERN=""
if echo "$COMMAND" | grep -qE '\brg\b'; then
  PATTERN=$(echo "$COMMAND" | sed -n "s/.*\brg\s\+\(--[^ ]*\s\+\)*['\"]\\?\([^'\";\| >]*\\).*/\2/p")
elif echo "$COMMAND" | grep -qE '\bgrep\b'; then
  PATTERN=$(echo "$COMMAND" | sed -n "s/.*\bgrep\s\+\(-[^ ]*\s\+\)*['\"]\\?\([^'\";\| >]*\\).*/\2/p")
fi

if [ -z "$PATTERN" ] || [ ${#PATTERN} -lt 3 ]; then
  echo '{"permission":"allow"}'
  exit 0
fi

# Run codragraph augment (prefer the global bin if present; fall back to bunx
# under Bun, otherwise npx)
if command -v codragraph >/dev/null 2>&1; then
  RESULT=$(codragraph augment "$PATTERN" 2>/dev/null)
elif [ "${npm_config_user_agent#bun/}" != "$npm_config_user_agent" ] && command -v bunx >/dev/null 2>&1; then
  RESULT=$(bunx @codragraph/cli augment "$PATTERN" 2>/dev/null)
elif ! command -v npx >/dev/null 2>&1 && command -v bunx >/dev/null 2>&1; then
  RESULT=$(bunx @codragraph/cli augment "$PATTERN" 2>/dev/null)
else
  RESULT=$(npx -y @codragraph/cli augment "$PATTERN" 2>/dev/null)
fi

if [ -n "$RESULT" ]; then
  # Escape for JSON
  ESCAPED=$(echo "$RESULT" | jq -Rs .)
  echo "{\"permission\":\"allow\",\"agent_message\":$ESCAPED}"
else
  echo '{"permission":"allow"}'
fi

exit 0
