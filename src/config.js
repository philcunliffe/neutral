// @ts-check
// Per-repo configuration, so neutral fits a project's layout instead of assuming
// its own. Loaded from `.neutral/config.json`, merged over the defaults. Missing
// file → defaults. @ref LLP 0007#configuration
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** @import { NeutralConfig } from './types.d.ts' */

// Maintenance-family constants (LLP 0008/0009). The labels are the authorization
// gate: neutral acts on an artifact it did not mint only when a human delegated it.
// @ref LLP 0009#the-authorization-gate [implements]
export const FIX_LABEL = 'neutral:fix'      // a human delegates an issue for a fix attempt
export const STUCK_LABEL = 'neutral:stuck'  // neutral sets this when it cannot complete one
// The reconcilePR review rung's fix-loop bound: past this many rounds with the head
// still unreviewed, the PR is surfaced as stuck rather than churned forever.
// @ref LLP 0009#pr-health-reconciler [implements] — N=2 fix rounds
export const DEFAULT_REVIEW_ROUNDS = 2

/** @type {NeutralConfig} */
export const DEFAULT_CONFIG = {
  // Where the LLP corpus lives.
  llpDir: 'llp',
  // Source-code discovery for `@ref` coverage. Broad by default so an existing
  // repo's annotations (wherever its code lives) count — not just src/bin/test.
  code: {
    exts: [
      '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.rb',
      '.java', '.kt', '.scala', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php',
      '.swift', '.sh', '.bash', '.lua', '.ex', '.exs', '.clj', '.cljs', '.dart',
      '.vue', '.svelte', '.sql', '.graphql'
    ],
    exclude: [
      'node_modules', '.git', 'dist', 'build', 'out', 'vendor', 'target',
      '.next', 'coverage', '.venv', 'venv', '__pycache__', '.neutral'
    ]
  },
  // Type -> pipeline role. A project can remap these (e.g. say `plan` is a human
  // doc here, not a neutral impl-design) without touching code.
  roles: {
    request: ['spec', 'rfc', 'issue'],
    design: ['design', 'plan']
  },
  // Statuses that mean a request has left Draft and is live.
  liveStatuses: ['accepted', 'active']
}

/**
 * @param {NeutralConfig} base
 * @param {any} over
 * @returns {NeutralConfig}
 */
function merge(base, over) {
  const o = over && typeof over === 'object' ? over : {}
  const code = o.code && typeof o.code === 'object' ? o.code : {}
  const roles = o.roles && typeof o.roles === 'object' ? o.roles : {}
  return {
    llpDir: o.llpDir || base.llpDir,
    code: {
      exts: Array.isArray(code.exts) ? code.exts : base.code.exts,
      exclude: Array.isArray(code.exclude) ? code.exclude : base.code.exclude
    },
    roles: {
      request: Array.isArray(roles.request) ? roles.request : base.roles.request,
      design: Array.isArray(roles.design) ? roles.design : base.roles.design
    },
    liveStatuses: Array.isArray(o.liveStatuses) ? o.liveStatuses : base.liveStatuses
  }
}

/**
 * Load `.neutral/config.json` merged over the defaults.
 * @param {string} repo
 * @returns {NeutralConfig}
 */
export function loadConfig(repo) {
  let raw
  try {
    raw = JSON.parse(readFileSync(join(repo, '.neutral', 'config.json'), 'utf8'))
  } catch {
    return DEFAULT_CONFIG
  }
  return merge(DEFAULT_CONFIG, raw)
}
