# Meta-Harness Research — Mapping to thinqmesh-codragraph

Research notes on integrating **Meta-Harness** (arXiv 2603.28052) into the
existing thinqmesh-codragraph semantic compression library.

- **Paper:** [Meta-Harness: End-to-End Optimization of Model Harnesses](https://arxiv.org/abs/2603.28052)
- **Authors:** Yoonho Lee, Roshen Nair, Qizheng Zhang, Kangwook Lee, Omar Khattab, Chelsea Finn (Stanford IRIS Lab + collaborators)
- **Submitted:** 2026-03-30
- **Reference code:** [github.com/stanford-iris-lab/meta-harness](https://github.com/stanford-iris-lab/meta-harness)

---

## 1. The Paper

### 1.1 Core thesis

LLM system performance depends not just on weights, but on the **harness** —
*the code around the model that decides what to store, retrieve, and present*.
Existing prompt/text optimizers (GEPA, OpenEvolve, ACE, MCE, Best-of-N,
TTT-Discover) compress feedback too aggressively for this domain. Meta-Harness
gives an agentic proposer (Claude Code) full filesystem access to every prior
candidate's source, scores, and traces — context budgets per evaluation reach
**~10M tokens** (3 orders of magnitude beyond prior text optimizers).

### 1.2 Algorithm 1 (the outer loop)

```
Input: tasks 𝒳, frozen LLM M, proposer P, iterations N
Init:  population ℋ ← {baseline harnesses}, filesystem 𝒟 ← ∅

for H ∈ ℋ:  𝒟 ← 𝒟 ∪ {(H, Evaluate(H, M, 𝒳))}

for t = 1..N:
    P queries 𝒟              # reads code, traces, scores by hand
    {H_1..H_k} ← P.propose()
    for H_i:
        if H_i passes interface validation:
            𝒟 ← 𝒟 ∪ {(H_i, Evaluate(H_i, M, 𝒳))}

return Pareto frontier of 𝒟
```

Deliberately minimal — **no parent selection, no mutation operators, no
scaffold constraints**. All search heuristics are delegated to the proposer's
coding ability. Per iteration, the proposer reads a median of 82 files
(~41% prior source, ~40% traces, ~6% scores, ~13% other).

### 1.3 Proposer mechanics

- **Identity:** Claude Code with Opus-4.6 configuration
- **Access pattern:** terminal commands (grep, cat, fs navigation) — not a single compressed prompt
- **Inspection budget:** can read 20+ prior candidates per proposal step
- **Filesystem layout per candidate:** source code + execution traces (prompts, tool calls, model outputs, state updates) + evaluation scores

### 1.4 Empirical wins

| Domain | Setup | Result |
|---|---|---|
| Online text classification | GPT-OSS-120B frozen, 3 search datasets (LawBench, Symptom2Disease, USPTO-50k), 9 OOD held-out | **+7.7 pts** over ACE/MCE with **4× fewer context tokens** |
| Math reasoning | GPT-OSS-20B → transferred to GPT-5.4-nano/mini, Gemini-3.1-Flash-Lite, Gemini-3-Flash | **+4.7 pts** pass@1 on 200 IMO-level problems vs. dense / BM25 / random baselines |
| TerminalBench-2 (agentic coding) | Claude Opus 4.6 / Haiku 4.5, 89 tasks | Beat hand-engineered Terminus 2, Terminus-KIRA, all reported Claude Haiku 4.5 entries |

### 1.5 Discovered harness shapes

All discovered harnesses are 100–1000 lines of Python.

**Text classification (Label-Primed Query):**
- Memory of labeled examples
- TF-IDF retrieval with similarity scoring
- Coverage block (one representative per output label)
- Contrastive pairing (similar examples with different labels side-by-side)
- Multi-part prompt assembly + single inference call

**Math retrieval:**
- Lexical router → 4 routes (combinatorics, geometry, number theory, default)
- Math-aware BM25 (preserves LaTeX atoms)
- Per-route post-processing: fetch-N → dedup → rerank → keep-K with route-specific K and reranker
- Inserts retrieved examples into reasoning prompt

**TerminalBench-2:**
- Environment bootstrap shell command (OS, languages, package managers, /app, memory)
- Native tool calling
- 30KB per-response output cap
- Multi-perspective completion checklist
- 15-second timeout guard

### 1.6 Reference repo shape

- `reference_examples/text_classification/` — `python meta_harness.py --iterations 1`
- `reference_examples/terminal_bench_2/` — `bash scripts/run_eval.sh agents.baseline_kira:AgentHarness ...`
- `claude_wrapper.py` per example — wraps Claude Code as the proposer, logs interactions
- `ONBOARDING.md` — guide to producing a domain spec for new tasks
- Uses `uv` for env management

---

## 2. The Existing Codebase — `thinqmesh-codragraph`

A semantic compression library. Three production methods + two benchmark suites:

| File | Method | Reduction | Cost | Surface to optimize |
|---|---|---|---|---|
| `codragraph_compress.py` | LLM (gpt-4o, sentence-by-sentence) | 40–58% | API | `prompts/compression.txt`, sentence-split logic, model choice, embedding-loss reporting |
| `mlm.py` | RoBERTa MLM, threshold-based word drop | 16–54% (P=1e-3..1e-6) | local GPU | `prob_threshold`, `no_adjacent_removal`, NER protection set, target-word tokenization |
| `nlp.py` | spaCy POS / stopword stripping | 15–30% | offline | stop sets per POS, intensifier list, conjunction filter, language-model choice |

**Rules** in `SPEC.md` are explicit and actionable: 9 numbered rules + 3 anti-patterns
(sentence atomicity, 2–5 word target, connective elimination, active voice,
preserve specifics, drop intensifiers, omit articles, pronoun handling, logical
completeness).

**Benchmarks already provide ready-made scoring functions:**
- `benchmark/factual_preservation/` — Q&A-based fact retrieval test, currently 13/13 facts at 18.6% compression.
- `benchmark/embedding_similarity/` — `text-embedding-3-large` cosine similarity vs. original.

---

## 3. The Fit — Why Meta-Harness Maps Cleanly Onto This Project

This isn't a stretch. The codebase is **unusually well-shaped** for Meta-Harness because:

1. **A population ℋ already exists.** `codragraph_compress.py`, `mlm.py`, `nlp.py` —
   three diverse baselines, exactly the seeding pattern in the paper
   (`{zero-shot, few-shot, ACE, MCE}`).

2. **Multi-objective scores already exist.** Compression ratio ⊕
   fact-preservation rate ⊕ embedding similarity is a *natural* Pareto frontier —
   accuracy-vs-cost is precisely the frontier the paper reports for text
   classification.

3. **The "harness" surface is already isolated.** The compression prompt
   (`prompts/compression.txt`), the MLM threshold + protected-NER set, the NLP
   stopword/POS lists — these are the edit targets. A proposer can mutate them
   as code.

4. **The benchmark structure is the `Evaluate(H, M, 𝒳)` call.** `test_data.json`
   is the search-set 𝒳. The Q&A verifier returns a scalar reward.

5. **Compression is a domain the paper didn't ship.** The paper's three domains
   were classification, math retrieval, agentic coding. Compression is a fourth,
   untested domain — and arguably a cleaner one because the reward signal
   (fact preservation × token reduction) is mechanically computable without
   needing an LLM judge in the loop.

---

## 4. Concrete Integration Shape

Proposed mapping:

```
thinqmesh-codragraph/
├── meta_harness/
│   ├── proposer.py          # Claude Code wrapper (analog to claude_wrapper.py)
│   ├── evaluator.py         # wraps benchmark/ as Evaluate(H, 𝒳) → (reduction, fact_rate, emb_sim)
│   ├── filesystem.py        # 𝒟 = ./candidates/<id>/{source/, traces/, score.json}
│   ├── outer_loop.py        # Algorithm 1
│   └── interface.py         # validation: every harness must export compress(text) -> str
├── candidates/              # filesystem 𝒟, append-only
│   ├── 000_codragraph_baseline/
│   ├── 001_mlm_baseline/
│   ├── 002_nlp_baseline/
│   └── 003_proposed/...
└── seeds/
    └── (the three current methods, lifted into the harness interface)
```

### 4.1 Three design calls to think through

- **What can the proposer mutate?** Aggressive: full Python source. Conservative:
  just `prompts/compression.txt` + a few hyperparameter slots. The paper's
  evidence says *aggressive wins* — restricting the surface throws away the
  proposer's main strength (writing 100–1000 line harnesses).

- **Search-set vs. test-set split.** Right now `test_data.json` has only 2 cases —
  too small. Needs ~30–50 search cases and a held-out ~20 test cases, otherwise
  the proposer overfits to specific facts.

- **Reward shaping.** Single scalar (`α·reduction + β·fact_rate`) is easier but
  loses Pareto info. Pareto frontier is the paper's choice and matches the
  existing trade-off framing in `README.md`.

### 4.2 Harness interface (proposed)

```python
# meta_harness/interface.py
from typing import Protocol

class Harness(Protocol):
    def compress(self, text: str) -> str: ...

# Optional metadata for the filesystem record:
#   - name, version, params, init_cost (model load), per_call_cost
```

### 4.3 Evaluator signature (proposed)

```python
# meta_harness/evaluator.py
def evaluate(harness: Harness, search_set: list[TestCase]) -> Scores:
    """
    Returns:
        compression_ratio: float (mean across search set)
        fact_preservation_rate: float (mean Q&A pass rate)
        embedding_similarity: float (mean cosine to original)
        latency_ms: float
        traces: list[Trace] (per-case input/output/intermediate)
    """
```

### 4.4 Filesystem layout per candidate

```
candidates/003_proposed_xxxx/
├── source/                  # the harness code (read by proposer for next iteration)
│   ├── compress.py
│   └── prompts/             # if applicable
├── traces/                  # one file per search-set case
│   ├── case_001.json        # {input, output, intermediate_state, latency}
│   └── ...
├── score.json               # {compression_ratio, fact_rate, emb_sim, ...}
└── README.md                # proposer's natural-language rationale
```

This mirrors the paper's filesystem 𝒟 — the proposer can `grep` traces for
failure modes, diff source against prior candidates, and read score.json for
quick comparison.

---

## 5. Honest Tensions

- **Cost.** A real Meta-Harness run is *expensive* — ~10M proposer tokens × 20
  iterations + N×k harness evaluations × per-text gpt-4o calls. The paper used
  Claude Opus 4.6 as proposer; this would be on the order of $50–200 per full
  run depending on benchmark size.

- **Reference code is sparse.** The GitHub repo is reference-only with two
  examples — this would be porting structure, not vendoring a library.

- **The problem is smaller-scoped than the paper's.** Compression has a tighter
  hypothesis space than agentic coding, so gains may be more modest than the
  paper's headline numbers (and a well-tuned `codragraph_compress.py` is already strong).

- **The fact-preservation benchmark needs to grow first.** 13 facts is below the
  noise floor for differentiating harnesses.

---

## 6. Suggested First Move

The natural first move, if committing to this, is **prerequisite work that's
useful either way**:

1. Expand `test_data.json` to ~50 cases with diverse content types (factual
   reports, system prompts, API docs, agent reasoning, RAG passages).
2. Lift the three existing methods into a uniform `compress(text) -> str`
   interface in a `seeds/` directory.
3. Wrap the existing benchmark scripts behind a single `evaluate(harness)` call
   that returns a `Scores` dataclass with the three objectives.

Only after that does the outer loop and proposer wrapper become worth building.

---

## 7. Sources

- [Meta-Harness paper (arXiv abstract)](https://arxiv.org/abs/2603.28052)
- [Meta-Harness HTML full text](https://arxiv.org/html/2603.28052v1)
- [stanford-iris-lab/meta-harness reference code](https://github.com/stanford-iris-lab/meta-harness)
- [ArxivIQ summary](https://arxiviq.substack.com/p/meta-harness-end-to-end-optimization)
- [Hugo Cisneros notes](https://hugocisneros.com/notes/leemetaharnessendtoend2026/)
- [Hugging Face report on Meta-Harness](https://huggingface.co/blog/Svngoku/meta-harness-end-to-end-optimization-of-model)
