// @ts-check
// In-flight coverage: which requests are already covered by a `design`/`plan` LLP
// on an open `integration/*` branch (a change set being built but not yet merged).
// Without this the reconciler would re-design the same request on every poll.
// @ref LLP 0003#coverage-invariant
import { run, integrationBranches, resolveRef } from './git.js'
import { extractRefs } from './refs.js'

/**
 * LLP numbers `@ref`'d by design/plan LLPs on any in-flight integration branch.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<Set<number>>}
 */
export async function inFlightCoveredRefs(repo, exec = run) {
  /** @type {Set<number>} */
  const covered = new Set()
  let branches
  try {
    branches = await integrationBranches(repo, exec)
  } catch {
    return covered
  }
  for (const branch of branches) {
    const ref = await resolveRef(repo, branch, exec)
    if (!ref) continue
    let listing
    try {
      listing = await exec('git', ['ls-tree', '-r', '--name-only', ref, 'llp/'], repo)
    } catch {
      continue
    }
    for (const file of listing.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (!/\.(design|plan)\.md$/.test(file)) continue
      let body
      try {
        body = await exec('git', ['show', `${ref}:${file}`], repo)
      } catch {
        continue
      }
      for (const n of extractRefs(body)) covered.add(n)
    }
  }
  return covered
}
