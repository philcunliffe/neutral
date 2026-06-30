// @ts-check
// Design-first intake: a `design` LLP merged to the target branch at Status: Accepted
// is approved-but-unbuilt — neutral plans + implements it WITHOUT a preceding request,
// "skipping the first step" (the Designer). The Accepted/Active status IS the trigger:
// Accepted = approved for implementation, Active = built and merged (LLP 0003/0015), and
// because neutral mints its OWN designs Active, only human design-first work is Accepted —
// no need to gate on `Generated-by`. An Accepted design with no `integration/<slug>` branch
// yet is implementable; once the branch exists the change set is in flight (reconcilePR /
// implement drive it), and once the design flips to Active on target it is shipped.
// @ref LLP 0016#intake [implements]
import { run, defaultBranch, integrationBranches, showFile } from './git.js'
import { parseLlp } from './llp.js'
import { DEFAULT_CONFIG } from './config.js'

/** @import { Llp, NeutralConfig } from './types.d.ts' */

/**
 * PURE: from the parsed design LLPs on the target branch and the in-flight integration
 * slugs, the designs implementable now — type `design`, Status: Accepted (approved, not
 * yet built), and not already being built on an integration branch. Unit-tested offline
 * like the other classifiers (idleState, selectRung).
 * @param {Llp[]} designsOnTarget
 * @param {Set<string>} integrationSlugs
 * @returns {Array<{ number: number, slug: string, title: string }>}
 * @ref LLP 0003#design-first-intake [implements]
 */
export function selectImplementable(designsOnTarget, integrationSlugs) {
  return designsOnTarget
    .filter(l => l.type.toLowerCase() === 'design' && l.status.toLowerCase() === 'accepted')
    .filter(l => !integrationSlugs.has(l.slug))
    .map(l => ({ number: l.number, slug: l.slug, title: l.title }))
}

/**
 * Observe implementable designs from the target branch (`origin/<default>`). Reads the
 * MERGED corpus from git (ground truth), not the working tree — the trigger is "merged
 * to target", so a still-local Accepted design does not fire (LLP 0002). gh/git failures
 * degrade to an empty list, never an exception.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @param {NeutralConfig} [config]
 * @returns {Promise<Array<{ number: number, slug: string, title: string }>>}
 */
export async function collectImplementable(repo, exec = run, config = DEFAULT_CONFIG) {
  let target
  try {
    target = `origin/${await defaultBranch(repo, exec)}`
  } catch {
    return []
  }
  let listing
  try {
    listing = await exec('git', ['ls-tree', '-r', '--name-only', target, config.llpDir + '/'], repo)
  } catch {
    return []
  }
  /** @type {Llp[]} */
  const designs = []
  for (const file of listing.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (!/\.design\.md$/.test(file)) continue
    const body = await showFile(repo, target, file, exec)
    if (body === null) continue
    const llp = parseLlp(basename(file), body)
    if (llp) designs.push(llp)
  }
  /** @type {Set<string>} */
  const slugs = new Set()
  try {
    for (const b of await integrationBranches(repo, exec)) {
      const m = b.match(/integration\/(.+)$/)
      if (m) slugs.add(m[1])
    }
  } catch { /* no branches */ }
  return selectImplementable(designs, slugs)
}

/** @param {string} p @returns {string} */
function basename(p) {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}
