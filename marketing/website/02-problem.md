# The Problem

## Section title

**Your agent is reading the whole library to answer one question.**

## Body

Every agentic AI workflow looks roughly the same:

1. User asks the agent something — "fix this bug", "review this PR", "where is `validateUser` called from?"
2. The agent runs `grep`, `find`, or `read_file` ten times.
3. It pulls 30,000 tokens of *mostly irrelevant* code into context.
4. The model wades through the slop.
5. It costs 30¢, takes 90 seconds, and the answer is sometimes wrong because the *one critical file* got drowned out.

This is the standard agentic loop. It's wasteful at every layer:

- **Most retrieved tokens are noise.** Agents grab everything that matches a substring.
- **Larger context windows mask the problem.** Claude has 200k now. Gemini has 2M. Throwing more context at slop retrieval doesn't fix slop retrieval — it just hides the cost.
- **Smaller, cheaper models can't compete** because they get the same noisy context as the big models. So teams default to flagship models everywhere — and the bill compounds.
- **Every agent rebuilds the same retrieval logic from scratch.** Cursor, Aider, Copilot, Claude Code, Codex — each ships its own ad-hoc context engine. None of them learn from your codebase's history.

## The hidden cost

The bill is quiet. Each agent call adds up — until you check the dashboard at end of month and find your team spent $4,000 on tokens, mostly on context the model didn't need.

## What's missing

A layer between **your codebase** and **your agent** that:

- Knows your code as a graph, not as text — so it retrieves *relationships*, not substrings
- Compresses what survives retrieval, defensively — so the worst-case cost is bounded
- Learns the right recipe per task, automatically — so you don't hand-tune prompts forever
- Remembers what worked, versioned against your code — so the harness doesn't re-tune from scratch every time

That layer is CodraGraph.

## Visual cue (designer brief)

A side-by-side comparison:

**LEFT (without CodraGraph):**
- Question → grep → 32k tokens of slop → flagship model → answer
- Cost: $0.16 · Time: 90s · Accuracy: 80%

**RIGHT (with CodraGraph):**
- Question → graph subgraph + compression + tuned recipe → 3k tokens of relevant context → smaller model → answer
- Cost: $0.005 · Time: 8s · Accuracy: matches flagship on routine tasks

Numbers are illustrative — actual savings vary by workflow.
