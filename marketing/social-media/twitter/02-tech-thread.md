# Twitter / X — Technical Deep Dive Thread

**Format:** 6-tweet thread, technical audience.

---

**1/6**
Most "AI for code" tools today do retrieval over text. That's the wrong primitive.

Code has structure. The right retrieval primitive is the graph.

Here's what changes when you treat code as a graph:

---

**2/6**
Substring search:
"Find calls to validateUser"
→ grep matches: 47
→ false positives (variable named validateUser, comments, docs): 23
→ misses: indirect dispatch via inheritance, dynamic property access

---

**3/6**
Graph-aware:
codragraph_impact(target: "validateUser", direction: "upstream")

Returns:
- 7 direct callers (depth=1, HIGH risk)
- 4 indirect callers via interface dispatch (depth=2, MEDIUM)
- Risk-stratified, file-pathed, confidence-scored

Same query. 0 false positives. Catches what grep can't.

---

**4/6**
The graph captures:
• 45 node types (Function, Class, Method, Route, Tool, Process, FeatureCluster, etc.)
• 23 relationship types (CALLS, EXTENDS, IMPLEMENTS, FEATURE_MEMBER_OF, FEATURE_DEPENDS_ON, METHOD_OVERRIDES…)
• Per-language MRO walks (C3 for Python, ruby-mixin for Ruby, first-wins for Java/C#)
• Product/domain feature packs for areas like Settings, Auth, AI, Billing

Agents read 8–10× fewer tokens for the same answer.

---

**5/6**
But here's the key insight: graph retrieval alone leaves savings on the table.

The compounding stack:
1. Graph: 8–10× reduction
2. Compression: 1.4× more
3. Auto-tuned harness: finds the optimal pipeline per task family
4. Versioned recipe memory: amortize harness cost across runs

End to end: 60–85%.

---

**6/6**
CodraGraph ships all four layers in one MCP server + npm SDK.

Local-first. 16 languages. BYO inference (Claude / Codex / OpenCode / your own).

Architecture in this thread; install in one line:

```
npx codragraph analyze .
```

Open core, soon on npm. Ping for access.

---

## Notes

- Position the technical depth as a credibility move
- Tweet 4 is dense — designers/devs will copy it; that's good
