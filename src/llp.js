// @ts-check
// Parse the LLP corpus under <repo>/llp. Everything in the pipeline is an LLP;
// the `type` field carries its ROLE in the flow: request | design | background.
// @ref LLP 0003#types-and-roles — roles, eligibility, status normalization
import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { extractRefs } from './refs.js'

/** @import { Llp } from './types.d.ts' */

// `NNNN-<slug>.<type>.md`
const FILE_RE = /^(\d{4})-(.+)\.([a-z0-9]+)\.md$/

/** Types that REQUEST work and therefore need a design covering them. */
export const REQUEST_TYPES = new Set(['spec', 'rfc', 'issue'])

/** Types that ARE designs — they provide coverage and never need their own. */
export const DESIGN_TYPES = new Set(['design', 'plan'])

/** Statuses that mean an LLP has left Draft and is still live. */
export const LIVE_STATUSES = new Set(['accepted', 'active'])

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/**
 * @param {string} field
 * @param {string} body
 * @returns {string}
 */
function headerField(field, body) {
  const m = body.match(new RegExp('^\\*\\*' + field + ':\\*\\*\\s*(.+)$', 'm'))
  return m ? m[1].trim() : ''
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function csv(value) {
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Normalize a raw status: strip `vN` suffixes and trailing parentheticals, trim.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeStatus(raw) {
  return raw
    .replace(/\s+v\d+$/i, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
}

/**
 * Pure parse of one LLP file (no fs). Returns null if the name isn't `NNNN-*.md`.
 * Caller sets `.path`.
 * @param {string} name  the file basename
 * @param {string} body
 * @param {boolean} [tombstoned]
 * @returns {Llp | null}
 */
export function parseLlp(name, body, tombstoned = false) {
  const m = name.match(FILE_RE)
  if (!m) return null
  const titleMatch = body.match(/^#\s+LLP\s+\d+:\s*(.+)$/m)
  const status = tombstoned
    ? 'Tombstoned'
    : normalizeStatus(headerField('Status', body)) || 'Unknown'
  const generatedBy = headerField('Generated-by', body)
  return {
    number: Number(m[1]),
    slug: m[2],
    type: m[3],
    title: titleMatch ? titleMatch[1].trim() : '(untitled)',
    status,
    systems: csv(headerField('Systems', body)),
    author: headerField('Author', body),
    date: headerField('Date', body),
    path: '',
    refs: extractRefs(body),
    dependsOn: csv(headerField('Depends-on', body)),
    generatedBy: generatedBy || undefined
  }
}

/**
 * Read and parse every `NNNN-*.md` under <repo>/llp (recursively). Files under
 * `llp/tombstones/` are forced to `Tombstoned`.
 * @param {string} repo
 * @returns {Llp[]}
 */
export function readLlps(repo) {
  /** @type {Llp[]} */
  const llps = []
  for (const path of walk(join(repo, 'llp'))) {
    const llp = parseLlp(basename(path), readFileSync(path, 'utf8'), path.includes('/tombstones/'))
    if (!llp) continue
    llp.path = path
    llps.push(llp)
  }
  llps.sort((a, b) => a.number - b.number)
  return llps
}

/** @param {Llp} llp @returns {boolean} */
export function isRequestType(llp) {
  return REQUEST_TYPES.has(llp.type.toLowerCase())
}

/** @param {Llp} llp @returns {boolean} */
export function isDesignType(llp) {
  return DESIGN_TYPES.has(llp.type.toLowerCase())
}

/** @param {Llp} llp @returns {boolean} */
export function isLive(llp) {
  return LIVE_STATUSES.has(llp.status.toLowerCase())
}

/**
 * A live request that must be covered by a design (or by code).
 * @param {Llp} llp
 * @returns {boolean}
 */
export function needsCoverage(llp) {
  return isRequestType(llp) && isLive(llp)
}
