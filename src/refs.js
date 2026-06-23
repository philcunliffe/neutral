// @ts-check
// `@ref` extraction + a source scanner. The @ref mechanism is the single
// coverage primitive: a design @ref's the requests it covers; code @ref's the
// LLP sections it realizes. @ref LLP 0003#coverage-invariant
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// LLP reference syntax (LLP 0000 of the LLP system): `@ref LLP NNNN` with
// optional zero-padding and an optional `#anchor` we ignore for coverage.
const REF_RE = /@ref\s+LLP\s+0*(\d{1,4})/gi

const CODE_DIRS = ['src', 'bin', 'test']
const CODE_EXT = /\.(?:js|mjs|cjs|ts)$/

/**
 * Distinct LLP numbers referenced by `@ref LLP NNNN` in `text`.
 * @param {string} text
 * @returns {number[]}
 */
export function extractRefs(text) {
  /** @type {Set<number>} */
  const nums = new Set()
  for (const m of text.matchAll(REF_RE)) nums.add(Number(m[1]))
  return [...nums].sort((a, b) => a - b)
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkCode(dir) {
  /** @type {string[]} */
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...walkCode(join(dir, e.name)))
    } else if (CODE_EXT.test(e.name)) {
      out.push(join(dir, e.name))
    }
  }
  return out
}

/**
 * Scan source for `@ref LLP NNNN`. An LLP referenced by code is already
 * realized, so it counts as covered even without a design — this is how
 * bootstrap-built specs drop out of the backlog.
 * @param {string} repo
 * @returns {Set<number>}
 */
export function readCodeRefs(repo) {
  /** @type {Set<number>} */
  const refs = new Set()
  for (const d of CODE_DIRS) {
    for (const p of walkCode(join(repo, d))) {
      for (const n of extractRefs(readFileSync(p, 'utf8'))) refs.add(n)
    }
  }
  return refs
}
