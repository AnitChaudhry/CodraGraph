# Twitter / X — The Moat Thread

**Format:** 7-tweet thread. The deepest pitch — for engineers who'd build on top.

---

**1/7**
Most AI-for-code tools have ONE good idea. Sourcegraph: graph indexing. Cursor: editor UX. Copilot: completions.

Codragraph stacks four. The fourth is the actual moat. Let me explain what nobody else does. 🧵

---

**2/7**
Auto-tuned harness search (idea #3) is real — Stanford published the Meta-Harness paper in March 2026. It works:
• 3 roles (explorer / exploiter / critic) propose harness variants
• Pareto-optimal recipes selected
• +7.7 pts accuracy with 4× fewer tokens

But there's a problem.

---

**3/7**
The problem: harness search is EXPENSIVE.

Running Explorer + Exploiter + Critic for 30 iterations across a real task family costs $50–200 in proposer tokens.

Pay that every analyze cycle? No.
Pay it once per repo and reuse? How — recipes drift as code changes.

This is where the moat sits.

---

**4/7**
Codragraph: each `analyze` produces a content-addressed graph snapshot. sha256-rooted. Dolt-like.

Each harness run produces a Pareto frontier of recipes.

We tag recipes against the snapshot:
recipe_id → (snapshot_id, task_family, scores)

---

**5/7**
Next task arrives. Lookup:
• Recipe for (current_snapshot, this_task_family)
• If found AND the relevant subgraph hasn't changed: REUSE
• If subgraph changed: re-search, but bootstrap from the closest known-good recipe

The harness search cost amortizes across thousands of runs.

---

**6/7**
"Subgraph hasn't changed" = structural diff over the recipe's required graph queries' result sets.

This is precise: a refactor that changes 50 unrelated files doesn't invalidate the recipe. A change to the actual functions the recipe queries → does invalidate.

Auto-invalidation, surgical.

---

**7/7**
Versioning + harness has been built separately. Stanford did harness. Dolt did versioned data. Sourcegraph did graph indexing.

Stacking all three with the recipe-memory layer ON TOP — that's what nobody has shipped.

That's Codragraph.

(Open core, drops next month. DM for access.)

---

## Notes

- This is the CTO / lead engineer pitch
- Don't water down the technical depth — they're the audience
- Emphasizes "stacking" — it's about what's on top of existing primitives
