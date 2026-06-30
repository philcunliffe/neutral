// @ts-check
// GitHub ground-truth observers — the second controller that shells out (beside
// git.js), here to `gh`. It only OBSERVES; the pure classifiers (prhealth.js,
// issuefix.js) decide. Every observed fact — mergeability, the check rollup, the
// head SHA — is GitHub's own independent computation, re-read fresh, not the acting
// agent's self-report (LLP 0002). gh failing (no remote, offline, unauthenticated)
// degrades to empty rather than throwing, so the deterministic suite stays offline.
// @ref LLP 0009#pr-health-reconciler [implements] — observe in-scope PRs/issues
import { run } from './git.js'

/** @import { PrObservation } from './types.d.ts' */

// The fields reconcilePR's rungs need: mergeability, the check rollup, the head SHA
// (every downstream fact is keyed to it), the body (carries review markers), and the
// labels (`neutral:stuck` halts auto-advance, mirroring the issue family).
const PR_VIEW_FIELDS = 'number,headRefName,baseRefName,isDraft,mergeable,mergeStateStatus,statusCheckRollup,headRefOid,body,labels'

/**
 * Numbers + head branches of every open PR. Used to enumerate; the per-PR health
 * read is `viewPR`. Empty on any gh failure.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<Array<{number: number, headRefName: string}>>}
 */
export async function listOpenPRs(repo, exec = run) {
  try {
    const out = await exec('gh', ['pr', 'list', '--state', 'open', '--json', 'number,headRefName', '--limit', '200'], repo)
    const arr = JSON.parse(out)
    return Array.isArray(arr) ? arr.map(p => ({ number: p.number, headRefName: p.headRefName || '' })) : []
  } catch {
    return []
  }
}

/**
 * Normalize a raw `gh pr view --json` object into a stable PrObservation. Kept pure
 * (no shell) so it is unit-testable independent of gh.
 * @param {any} o
 * @returns {PrObservation}
 */
export function normalizePR(o) {
  return {
    number: o.number,
    head: o.headRefName || '',
    base: o.baseRefName || '',
    isDraft: !!o.isDraft,
    mergeable: o.mergeable || 'UNKNOWN',
    mergeStateStatus: o.mergeStateStatus || 'UNKNOWN',
    rollup: Array.isArray(o.statusCheckRollup) ? o.statusCheckRollup : [],
    headSha: o.headRefOid || '',
    body: o.body || '',
    labels: (Array.isArray(o.labels) ? o.labels : []).map(/** @param {any} l */ l => (typeof l === 'string' ? l : l && l.name) || '')
  }
}

/**
 * Full health observation for one PR, or null if gh fails.
 * @param {string} repo
 * @param {number} n
 * @param {typeof run} [exec]
 * @returns {Promise<PrObservation | null>}
 */
export async function viewPR(repo, n, exec = run) {
  try {
    const out = await exec('gh', ['pr', 'view', String(n), '--json', PR_VIEW_FIELDS], repo)
    return normalizePR(JSON.parse(out))
  } catch {
    return null
  }
}

/**
 * Open issues carrying a label, with their labels flattened to name strings. The
 * label is the authorization gate (LLP 0009): no label, no observation. Empty on
 * gh failure.
 * @param {string} repo
 * @param {string} label
 * @param {typeof run} [exec]
 * @returns {Promise<Array<{number: number, title: string, labels: string[]}>>}
 */
export async function listLabelledIssues(repo, label, exec = run) {
  try {
    const out = await exec('gh', ['issue', 'list', '--state', 'open', '--label', label, '--json', 'number,title,labels', '--limit', '200'], repo)
    const arr = JSON.parse(out)
    return (Array.isArray(arr) ? arr : []).map(i => ({
      number: i.number,
      title: i.title || '',
      labels: (i.labels || []).map(/** @param {any} l */ l => (typeof l === 'string' ? l : l.name) || '')
    }))
  } catch {
    return []
  }
}

/**
 * Open PRs with their bodies, for `Fixes #N` scanning (does an attempt already link
 * this issue?). Empty on gh failure.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<Array<{number: number, body: string, headRefName: string}>>}
 */
export async function listOpenPRBodies(repo, exec = run) {
  try {
    const out = await exec('gh', ['pr', 'list', '--state', 'open', '--json', 'number,body,headRefName', '--limit', '200'], repo)
    const arr = JSON.parse(out)
    return (Array.isArray(arr) ? arr : []).map(p => ({ number: p.number, body: p.body || '', headRefName: p.headRefName || '' }))
  } catch {
    return []
  }
}
