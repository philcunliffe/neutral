// @ts-check
// Assemble the observed world from ground truth — the deterministic half of the
// reconcile loop. Per-repo config makes it fit an existing project's layout.
// @ref LLP 0001#decision — observe from ground truth
import { readLlps } from './llp.js'
import { readCodeRefs } from './refs.js'
import { coverage } from './coverage.js'
import { loadConfig } from './config.js'

/** @import { World } from './types.d.ts' */

/**
 * @param {string} repo
 * @returns {World}
 */
export function observe(repo) {
  const config = loadConfig(repo)
  const llps = readLlps(repo, config)
  const codeRefs = readCodeRefs(repo, config)
  return { repo, config, llps, coverage: coverage(llps, codeRefs, config) }
}
