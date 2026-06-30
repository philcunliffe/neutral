// @ts-check
// Assemble the observed world from ground truth — the deterministic half of the
// reconcile loop. Per-repo config makes it fit an existing project's layout.
// @ref LLP 0001#decision — observe from ground truth
import { readLlps } from './llp.js'
import { readCodeRefs } from './refs.js'
import { run, defaultBranch, resolveRef, readLlpsFromRef, readCodeRefsFromRef } from './git.js'
import { coverage } from './coverage.js'
import { loadConfig } from './config.js'

/** @import { World } from './types.d.ts' */

/**
 * Observe the world from the DEFAULT BRANCH ref (`origin/<default>` when fetched, else
 * the local branch), not the working tree. The reconcile tick keeps the main checkout
 * read-only and only `git fetch`es (LLP 0012), so reading the working tree would miss
 * any request merged to master since the checkout was last pulled — the pipeline family
 * would look idle while real Designer work waits. Reading the corpus from the fetched
 * ref is the same ground-truth move `neutral implementable` makes (LLP 0002). When no
 * such ref resolves (a brand-new local repo with no commits on the branch), fall back to
 * the working tree so offline/greenfield use still works.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<World>}
 */
export async function observe(repo, exec = run) {
  const config = loadConfig(repo)
  let ref = null
  try {
    ref = await resolveRef(repo, await defaultBranch(repo, exec), exec)
  } catch {
    ref = null // not a git repo / git unavailable — fall back to the working tree
  }
  const llps = ref ? await readLlpsFromRef(repo, ref, config, exec) : readLlps(repo, config)
  const codeRefs = ref ? await readCodeRefsFromRef(repo, ref, config, exec) : readCodeRefs(repo, config)
  return { repo, config, llps, coverage: coverage(llps, codeRefs, config) }
}
