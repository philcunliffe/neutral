// @ts-check
// Parse the LLP corpus. Everything in the pipeline is an LLP; the `type` field
// carries its ROLE in the flow (request | design | background) — and the mapping
// is per-repo configurable, so neutral fits existing projects.
// @ref LLP 0003#types-and-roles — roles, eligibility, status normalization
import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { extractRefs } from './refs.js'
import { DEFAULT_CONFIG } from './config.js'

/** @import { Llp, NeutralConfig } from './types.d.ts' */

// `NNNN-<slug>.<type>.md`
const FILE_RE = /^(\d{4})-(.+)\.([a-z0-9]+)\.md$/

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
 * Read and parse every `NNNN-*.md` under the configured LLP directory.
 * @param {string} repo
 * @param {NeutralConfig} [config]
 * @returns {Llp[]}
 */
export function readLlps(repo, config = DEFAULT_CONFIG) {
  /** @type {Llp[]} */
  const llps = []
  for (const path of walk(join(repo, config.llpDir))) {
    const llp = parseLlp(basename(path), readFileSync(path, 'utf8'), path.includes('/tombstones/'))
    if (!llp) continue
    llp.path = path
    llps.push(llp)
  }
  llps.sort((a, b) => a.number - b.number)
  return llps
}

/** @param {Llp} llp @param {NeutralConfig} [config] @returns {boolean} */
export function isRequestType(llp, config = DEFAULT_CONFIG) {
  return config.roles.request.includes(llp.type.toLowerCase())
}

/** @param {Llp} llp @param {NeutralConfig} [config] @returns {boolean} */
export function isDesignType(llp, config = DEFAULT_CONFIG) {
  return config.roles.design.includes(llp.type.toLowerCase())
}

/** @param {Llp} llp @param {NeutralConfig} [config] @returns {boolean} */
export function isLive(llp, config = DEFAULT_CONFIG) {
  return config.liveStatuses.includes(llp.status.toLowerCase())
}

/**
 * A live request that must be covered by a design (or by code).
 * @param {Llp} llp @param {NeutralConfig} [config] @returns {boolean}
 */
export function needsCoverage(llp, config = DEFAULT_CONFIG) {
  return isRequestType(llp, config) && isLive(llp, config)
}

/**
 * A design LLP that neutral itself minted — the pipeline stages (impl-design,
 * implement) act only on these, never on the project's own design/plan docs.
 * @param {Llp} llp @param {NeutralConfig} [config] @returns {boolean}
 */
export function isNeutralDesign(llp, config = DEFAULT_CONFIG) {
  return isDesignType(llp, config) && llp.generatedBy === 'neutral'
}
