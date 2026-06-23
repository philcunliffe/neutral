// @ts-check
// Assemble the observed world from ground truth — the deterministic half of the
// reconcile loop. Designs are LLPs in the corpus; runtime state is git.
// @ref LLP 0001#decision — observe from ground truth
import { readLlps } from './llp.js'
import { readCodeRefs } from './refs.js'
import { coverage } from './coverage.js'

/** @import { World } from './types.d.ts' */

/**
 * @param {string} repo
 * @returns {World}
 */
export function observe(repo) {
  const llps = readLlps(repo)
  const codeRefs = readCodeRefs(repo)
  return { repo, llps, coverage: coverage(llps, codeRefs) }
}
