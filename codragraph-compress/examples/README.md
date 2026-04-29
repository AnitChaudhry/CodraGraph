# Examples

All examples validated using `codragraph_compress.py` with GPT-4o.

Pairs live in two subfolders: `normal/` (original) and `codragraph/` (compressed).

## Files

**Core Examples:**
- `normal/resume.txt` / `codragraph/resume.txt` - Professional resume (201→156 tokens, 22%)
- `normal/system.txt` / `codragraph/system.txt` - AI assistant prompt (171→72 tokens, 58%)
- `normal/api.txt` / `codragraph/api.txt` - API auth docs (137→79 tokens, 42%)

**Use Case Examples:**
- `normal/support.txt` / `codragraph/support.txt` - RAG knowledge base doc (199→118 tokens, 41%)
- `normal/agent.txt` / `codragraph/agent.txt` - Agent internal reasoning (196→102 tokens, 48%)

## Usage

```bash
# Compress an example
python ../codragraph_compress.py compress -f normal/resume.txt

# Compare with validated output
cat codragraph/resume.txt
```
