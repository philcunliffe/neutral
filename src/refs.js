// @ts-check
// `@ref` extraction + a source scanner. The @ref mechanism is the single coverage
// primitive: a design @ref's the requests it covers; code @ref's the LLP sections
// it realizes. The code scan walks the WHOLE repo (per config), so an existing
// project's annotations count wherever its code lives. @ref LLP 0003#coverage-invariant
import { readdirSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { DEFAULT_CONFIG } from './config.js'

/** @import { NeutralConfig } from './types.d.ts' */

// LLP reference syntax (LLP 0000 of the LLP system): `@ref LLP NNNN` with optional
// zero-padding and an optional `#anchor` we ignore for coverage.
const REF_RE = /@ref\s+LLP\s+0*(\d{1,4})/gi

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
 * @param {Set<string>} excludeNames  directory basenames to skip
 * @param {Set<string>} exts  file extensions to include
 * @returns {string[]}
 */
function walkCode(dir, excludeNames, exts) {
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
      if (!excludeNames.has(e.name)) out.push(...walkCode(join(dir, e.name), excludeNames, exts))
    } else if (exts.has(extname(e.name).toLowerCase())) {
      out.push(join(dir, e.name))
    }
  }
  return out
}

/**
 * Scan the repo's source for `@ref LLP NNNN`. An LLP referenced by code is already
 * realized, so it counts as covered even without a design.
 * @param {string} repo
 * @param {NeutralConfig} [config]
 * @returns {Set<number>}
 */
export function readCodeRefs(repo, config = DEFAULT_CONFIG) {
  /** @type {Set<number>} */
  const refs = new Set()
  const exts = new Set(config.code.exts.map(e => e.toLowerCase()))
  const exclude = new Set([...config.code.exclude, config.llpDir])
  for (const p of walkCode(repo, exclude, exts)) {
    for (const n of extractRefs(readFileSync(p, 'utf8'))) refs.add(n)
  }
  return refs
}
