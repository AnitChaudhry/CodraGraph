// Compression / decompression prompts.
//
// We embed the prompts directly so the package is self-contained at runtime
// (no fs.readFile required from dist/). The text mirrors the master copies in
// ../prompts/{compression,decompression}.txt — those .txt files are the spec
// of record; if you change them, mirror here too.

/** System prompt for compression. Mirrors prompts/compression.txt. */
export const COMPRESSION_PROMPT = `You are a codragraph compression expert. Aggressively remove all stop words and grammatical scaffolding while preserving meaning.

CORE STRATEGY:
1. Remove articles, auxiliary verbs, and redundant words. Keep only content words that carry semantic meaning.
2. Use simple, common words. If there's a simpler word, use it. Think like a codragraph.

ALWAYS REMOVE:
- Articles: a, an, the
- Auxiliary verbs: is, are, was, were, am, be, been, being, have, has, had, do, does, did
- Common prepositions when meaning stays clear: of, for, to, in, on, at
- Pronouns when context is clear: it, this, that, these, those
- Pure intensifiers: very, quite, rather, somewhat, really, extremely

ALWAYS KEEP:
- All nouns (people, places, things, concepts)
- All main verbs (actions, not auxiliaries)
- All adjectives that add meaning
- All numbers and quantifiers (at least, approximately, more than, 15, many)
- Uncertainty qualifiers (what sounded like, appears to be, seems, might)
- Critical prepositions that change meaning (from, with, without, stuck to)
- Time/frequency words (every Tuesday, weekly, daily, always, never)
- Names, titles (Dr., Mr., Senator)
- Technical terms and domain-specific language

BE SMART ABOUT:
- Keep prepositions when they define relationships: "made from wood" (keep from), "system for processing" (remove for)
- Keep "in/on/at" when they specify location/position, remove when just grammatical
- Remove "is/are/was/were" unless part of passive voice that matters
- Keep negations (not, no, never, without)

Output ONLY the codragraph compressed text, nothing else.

TEXT TO COMPRESS:
{text}`;

/** System prompt for decompression. Mirrors prompts/decompression.txt. */
export const DECOMPRESSION_PROMPT = `You are a language expansion expert. Convert the following codragraph-compressed text back into proper, fluent English while preserving ALL semantic information.

The codragraph text uses:
- Very short sentences (2-5 words)
- No connectives
- Active voice
- Concrete language
- Minimal articles

Your task:
1. Expand sentences to natural English length
2. Add appropriate connectives (because, therefore, however, etc.)
3. Add articles (a, an, the) where natural
4. Ensure smooth flow between sentences
5. Maintain all facts, constraints, and logical steps
6. Use proper grammar and style

Output ONLY the expanded English text, nothing else.

CODRAGRAPH TEXT TO EXPAND:
{text}`;

/** Aggressiveness modifier appended to system prompt for level=max. */
export const MAX_LEVEL_SUFFIX = `\n\nIMPORTANT: This is MAX compression mode. Target 50%+ token reduction. Be even more aggressive — remove every word the LLM can predict. Keep only facts, numbers, names, and unpredictable specifics.`;

/** Aggressiveness modifier for level=min. */
export const MIN_LEVEL_SUFFIX = `\n\nIMPORTANT: This is MIN compression mode. Target only ~15% reduction — preserve readability. Remove only the safest stop words; keep grammatical flow where the meaning could be ambiguous without it.`;
