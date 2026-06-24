// @ts-check
// The adoption baseline: request LLPs that already exist / were built before
// neutral was adopted and should NOT be driven through the pipeline. Tracked at
// `.neutral/baseline.json`; `backlog` excludes these so a brownfield repo starts
// from a correct backlog. Prefer real `@ref` annotations; baseline is the escape
// hatch for what you can't or won't annotate. @ref LLP 0007#baseline
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Grandfathered request numbers from `.neutral/baseline.json`. Shape:
 * `{ "grandfathered": [{ "llp": 12, "reason": "...", "date": "..." }, ...] }`
 * (a bare list of numbers is also accepted). Missing file → empty set.
 * @param {string} repo
 * @returns {Set<number>}
 */
export function loadBaseline(repo) {
  /** @type {Set<number>} */
  const set = new Set()
  let raw
  try {
    raw = JSON.parse(readFileSync(join(repo, '.neutral', 'baseline.json'), 'utf8'))
  } catch {
    return set
  }
  const entries = Array.isArray(raw) ? raw : (Array.isArray(raw.grandfathered) ? raw.grandfathered : [])
  for (const e of entries) {
    const n = typeof e === 'number' ? e : Number(e && e.llp)
    if (Number.isInteger(n)) set.add(n)
  }
  return set
}
