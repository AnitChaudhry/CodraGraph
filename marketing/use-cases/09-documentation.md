# Use Case 09 — Living Documentation

## The job

> "Generate docs for our API surface that stay accurate as the code evolves."

Documentation drift is a tax every engineering team pays. Docs are written once; code changes weekly; six months later, half the docs are wrong.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| Mintlify, ReadMe | Beautiful docs hosting | You still maintain content manually |
| TypeDoc / Sphinx | Generated from comments | Only as good as the comments; rarely useful for reasoning |
| Backstage TechDocs | Service catalog docs | Org-level; not symbol-level |
| Hand-written + reviewer enforcement | Quality varies wildly | Costs senior engineering time |

## What Codragraph does differently

Codragraph treats docs as a **derived view of the graph**, not a separate artifact. Three docs that regenerate after every `codragraph analyze`:

### 1. `AGENTS.md` / `CLAUDE.md` (auto-generated, agent-targeted)
Architectural overview tuned for AI agents working in the repo:
- Pipeline phases, MCP tools available, key invariants, hard rules
- Always current — regenerated on every analyze
- Agents read this before any task → consistent behavior across team

### 2. `wiki/` generated docs (auto-generated, human-targeted)
`codragraph wiki` produces a navigable wiki:
- Per-package architecture page
- Per-service execution-flow walkthrough
- Per-API endpoint contract (with consumer list)
- Cross-references between symbols

### 3. Per-symbol enrichment (on-demand, agent-readable)
The graph itself acts as documentation: any symbol can be asked "explain yourself" via `codragraph_context`. Callers, callees, examples-in-tests, related processes — all live data.

## The before / after

**Before:** A senior engineer writes the architecture doc. Three months later, half of it is wrong (refactor, new service). The doc is updated quarterly. Onboarding hires get incorrect docs.

**After:** Architecture doc is regenerated nightly. Any structural drift between the doc and the code is caught immediately. New hires read accurate docs.

## Why the moat matters here

Docs are continuously consumed (humans + agents). The harness's "explain symbol X" recipe is reused thousands of times across the team. Versioned recipe memory keeps explanations consistent in style across the team's queries. When the codebase undergoes structural change (new framework, new pattern), recipes age out and re-tune — keeping docs fresh without manual rewrites.

Plus: each `codragraph analyze` snapshot becomes a **historical doc**. Want to know what the architecture looked like six months ago? Time-travel query against that snapshot.

## Sample doc generation

```bash
npx codragraph wiki .
```

Produces:
```
wiki/
├── README.md                    Architecture overview
├── packages/
│   ├── auth-service.md          Per-package walkthrough
│   ├── payment-service.md
│   └── ...
├── flows/
│   ├── user-login.md            Step-by-step process flow
│   ├── checkout.md
│   └── ...
└── api/
    ├── users.md                 Endpoints + consumers
    ├── payments.md
    └── ...
```

Hosted on your docs site (Mintlify, your own static site, GitBook). Regenerate on every analyze.

## Sample on-demand enrichment

```
You: Explain validateUser.

Claude (using codragraph_context + the explain-symbol recipe):
   validateUser (Function, src/auth/user.ts:42)

   Purpose: Validates user credentials against the user store.

   Called from:
     - src/api/login.ts (LOW risk consumer)
     - src/api/refresh.ts
     - src/middleware/session.ts
     - tests/auth.test.ts (3 fixtures use it)

   Calls into:
     - db/users.findByEmail
     - lib/bcrypt.compare
     - lib/audit.recordAttempt

   Participates in 2 execution flows:
     - user-login (step 3 of 6)
     - session-validation (step 2 of 4)

   Tested: yes — 4 test cases in auth.test.ts cover valid, invalid, locked,
   and rate-limited cases.

   Source:
   ```ts
   export async function validateUser(email: string, password: string): Promise<User | null> { ... }
   ```
```

## Honest limit

Auto-docs capture **structure**, not **intent**. ADRs ("we chose Postgres because...") still need humans. Docs about *why* a pattern exists, *what* tradeoffs were considered — those are human-authored, and that's correct. Codragraph documents what's there; people document what should be.
