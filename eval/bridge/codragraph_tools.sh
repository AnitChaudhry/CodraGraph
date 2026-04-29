#!/bin/bash
# CodraGraph CLI tool wrappers for SWE-bench evaluation
#
# These functions call the CodraGraph eval-server (HTTP daemon) for near-instant
# tool responses. The eval-server keeps KuzuDB warm in memory.
#
# If the eval-server is not running, falls back to direct CLI commands.
#
# Usage:
#   codragraph-query "how does authentication work"
#   codragraph-context "validateUser"
#   codragraph-impact "AuthService" upstream
#   codragraph-cypher "MATCH (n:Function) RETURN n.name LIMIT 10"
#   codragraph-overview

CODRAGRAPH_EVAL_PORT="${CODRAGRAPH_EVAL_PORT:-4848}"
CODRAGRAPH_EVAL_URL="http://127.0.0.1:${CODRAGRAPH_EVAL_PORT}"

_codragraph_call() {
    local tool="$1"
    shift
    local json_body="$1"

    # Try eval-server first (fastest path — KuzuDB stays warm)
    local result
    result=$(curl -sf -X POST "${CODRAGRAPH_EVAL_URL}/tool/${tool}" \
        -H "Content-Type: application/json" \
        -d "${json_body}" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$result" ]; then
        echo "$result"
        return 0
    fi

    # Fallback: direct CLI (cold start, slower but always works)
    case "$tool" in
        query)
            local q=$(echo "$json_body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('query',''))" 2>/dev/null)
            npx codragraph query "$q" 2>&1
            ;;
        context)
            local n=$(echo "$json_body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null)
            npx codragraph context "$n" 2>&1
            ;;
        impact)
            local t=$(echo "$json_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('target',''))" 2>/dev/null)
            local d=$(echo "$json_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('direction','upstream'))" 2>/dev/null)
            npx codragraph impact "$t" --direction "$d" 2>&1
            ;;
        cypher)
            local cq=$(echo "$json_body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('query',''))" 2>/dev/null)
            npx codragraph cypher "$cq" 2>&1
            ;;
        *)
            echo "Unknown tool: $tool" >&2
            return 1
            ;;
    esac
}

codragraph-query() {
    local query="$1"
    local task_context="${2:-}"
    local goal="${3:-}"

    if [ -z "$query" ]; then
        echo "Usage: codragraph-query <query> [task_context] [goal]"
        echo "Search the code knowledge graph for execution flows related to a concept."
        echo ""
        echo "Examples:"
        echo '  codragraph-query "authentication flow"'
        echo '  codragraph-query "database connection" "fixing connection pool leak"'
        return 1
    fi

    local args="{\"query\": \"$query\""
    [ -n "$task_context" ] && args="$args, \"task_context\": \"$task_context\""
    [ -n "$goal" ] && args="$args, \"goal\": \"$goal\""
    args="$args}"

    _codragraph_call query "$args"
}

codragraph-context() {
    local name="$1"
    local file_path="${2:-}"

    if [ -z "$name" ]; then
        echo "Usage: codragraph-context <symbol_name> [file_path]"
        echo "Get a 360-degree view of a code symbol: callers, callees, processes, file location."
        echo ""
        echo "Examples:"
        echo '  codragraph-context "validateUser"'
        echo '  codragraph-context "AuthService" "src/auth/service.py"'
        return 1
    fi

    local args="{\"name\": \"$name\""
    [ -n "$file_path" ] && args="$args, \"file_path\": \"$file_path\""
    args="$args}"

    _codragraph_call context "$args"
}

codragraph-impact() {
    local target="$1"
    local direction="${2:-upstream}"

    if [ -z "$target" ]; then
        echo "Usage: codragraph-impact <symbol_name> [upstream|downstream]"
        echo "Analyze the blast radius of changing a code symbol."
        echo ""
        echo "  upstream  = what depends on this (what breaks if you change it)"
        echo "  downstream = what this depends on (what it uses)"
        echo ""
        echo "Examples:"
        echo '  codragraph-impact "AuthService" upstream'
        echo '  codragraph-impact "validateUser" downstream'
        return 1
    fi

    _codragraph_call impact "{\"target\": \"$target\", \"direction\": \"$direction\"}"
}

codragraph-cypher() {
    local query="$1"

    if [ -z "$query" ]; then
        echo "Usage: codragraph-cypher <cypher_query>"
        echo "Execute a raw Cypher query against the code knowledge graph."
        echo ""
        echo "Schema: Nodes: File, Function, Class, Method, Interface, Community, Process"
        echo "Edges via CodeRelation.type: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS"
        echo ""
        echo "Examples:"
        echo "  codragraph-cypher 'MATCH (a)-[:CodeRelation {type: \"CALLS\"}]->(b:Function {name: \"save\"}) RETURN a.name, a.filePath'"
        echo "  codragraph-cypher 'MATCH (n:Class) RETURN n.name, n.filePath LIMIT 20'"
        return 1
    fi

    _codragraph_call cypher "{\"query\": \"$query\"}"
}

codragraph-overview() {
    echo "=== Code Knowledge Graph Overview ==="
    _codragraph_call list_repos '{}'
}

# Export functions so they're available in subshells
export -f _codragraph_call 2>/dev/null
export -f codragraph-query 2>/dev/null
export -f codragraph-context 2>/dev/null
export -f codragraph-impact 2>/dev/null
export -f codragraph-cypher 2>/dev/null
export -f codragraph-overview 2>/dev/null
