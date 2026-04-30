#!/usr/bin/env node
/**
 * Optional LLM-augmented review on top of the deterministic comment.
 *
 * Calls Anthropic with the structural diff JSON + the deterministic baseline,
 * asks for a richer human-readable review, and emits the augmented Markdown
 * on stdout. Falls back silently to the deterministic baseline if the API
 * call fails — never breaks the action.
 *
 * Usage:  ANTHROPIC_API_KEY=... node llm-review.mjs <diff.json> <comment.md>
 */
import fs from 'node:fs';

const [, , diffPath, basePath] = process.argv;
if (!diffPath || !basePath) {
  console.error('Usage: llm-review.mjs <diff.json> <baseline-comment.md>');
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(diffPath, 'utf8'));
const baseline = fs.readFileSync(basePath, 'utf8');
const apiKey = process.env.ANTHROPIC_API_KEY || '';
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

if (!apiKey) {
  // Caller asked for review mode but didn't pass a key — emit baseline so the
  // action doesn't hard-fail.
  process.stdout.write(baseline);
  process.exit(0);
}

// Compact the diff JSON aggressively — large diffs balloon prompt cost without
// adding review value. Keep the most signal-rich fields.
const compactDiff = {
  from: data.from,
  to: data.to,
  semantic: {
    addedAPIs: (data.semantic?.addedAPIs || []).slice(0, 30),
    removedAPIs: (data.semantic?.removedAPIs || []).slice(0, 30),
    classifiedModifications: (data.semantic?.classifiedModifications || []).slice(0, 50),
    addedProcesses: (data.semantic?.addedProcesses || []).slice(0, 20),
    removedProcesses: (data.semantic?.removedProcesses || []).slice(0, 20),
  },
};

const prompt = `You are reviewing a pull request via the CodraGraph structural diff.
Below is (1) a deterministic baseline PR comment that will be posted, and (2) the
raw diff JSON.

Your job: produce ONE complete Markdown PR comment that REPLACES the baseline. Do:
- Start with the SAME comment marker on the very first line.
- Keep the deterministic Summary table verbatim.
- Add a "### Review notes" section ABOVE the Summary with:
  * Risk justification in 1-2 sentences (don't restate the heuristic).
  * Any d=1 callers likely affected by removed/modified APIs (call them out by
    name when the diff hints at them).
  * What's PROBABLY MISSING from this PR (test updates? docs? caller updates?).
- Keep the whole comment under 500 words.
- Do NOT invent symbols not in the diff. Cite only what's in the JSON.
- Do NOT include any preamble, code fences around the comment, or "Here's your
  review:" — emit the Markdown directly.

--- DETERMINISTIC BASELINE ---
${baseline}

--- DIFF JSON ---
${JSON.stringify(compactDiff, null, 2)}
`;

let res;
try {
  res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
} catch (err) {
  process.stderr.write(`LLM review fetch failed: ${err?.message || err}\n`);
  process.stdout.write(baseline);
  process.exit(0);
}

if (!res.ok) {
  const errBody = await res.text();
  process.stderr.write(`LLM review API ${res.status}: ${errBody.slice(0, 600)}\n`);
  process.stdout.write(baseline);
  process.exit(0);
}

const json = await res.json();
const text = json?.content?.[0]?.text;
if (!text || typeof text !== 'string' || text.trim().length === 0) {
  process.stderr.write('LLM review returned empty content; emitting baseline.\n');
  process.stdout.write(baseline);
  process.exit(0);
}

process.stdout.write(text);
