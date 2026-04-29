// Seed harnesses — the initial population ℋ for the outer loop.
//
// New seeds are easy to add: write a file in this directory exporting a
// `Harness`, then add it here. The proposer reads these to understand the
// baseline behavior before mutating.

export { zeroShot } from './zero-shot.js';
export { fewShot } from './few-shot.js';
export { graphAware } from './graph-aware.js';

import { zeroShot } from './zero-shot.js';
import { fewShot } from './few-shot.js';
import { graphAware } from './graph-aware.js';

import type { Harness } from '../interface.js';

/** All seeds, in canonical order. */
export const ALL_SEEDS: Harness[] = [zeroShot, fewShot, graphAware];

/** Look up seeds by name. Used by the CLI's --seeds flag. */
export const SEEDS_BY_NAME: Record<string, Harness> = Object.fromEntries(
  ALL_SEEDS.map((s) => [s.name, s]),
);
