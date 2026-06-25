// @ts-check
// Issue-fix: classify whether a `neutral:fix` issue already has a fix attempt, from
// observed git/gh ground truth — a `fix/issue-N` branch, a `Fixes #N` PR, or a
// `neutral:stuck` label — never a stored flag (LLP 0002). The reconciler's whole job
// is issue -> fix PR; PR-health (reconcilePR) then carries that PR to held + green +
// reviewed, so the two invariants compose.
// @ref LLP 0009#issue-fix-reconciler [implements]
import { STUCK_LABEL } from './config.js'

/** @import { IssueFixState } from './types.d.ts' */

// GitHub closing keywords. The spec mints `Fixes #N`; we recognise the whole closing
// set so any human-or-neutral PR that closes the issue counts as an attempt and is
// not duplicated.
const FIXES_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+#(\d+)/gi

/**
 * The conventional fix branch for an issue. The branch's existence is itself the
 * idempotency key — re-derived from git, not a flag.
 * @param {number} n
 * @returns {string}
 */
export function fixBranchName(n) {
  return `fix/issue-${n}`
}

/**
 * Issue numbers a PR body links via a GitHub closing keyword (`Fixes #N`). GitHub
 * closes the issue on merge; neutral never closes it itself (LLP 0009 step 5).
 * @param {string} body
 * @returns {number[]}
 */
export function fixedIssueNumbers(body) {
  /** @type {Set<number>} */
  const nums = new Set()
  for (const m of String(body || '').matchAll(FIXES_RE)) nums.add(Number(m[1]))
  return [...nums].sort((a, b) => a - b)
}

/**
 * A branch list entry names this issue's fix branch (tolerating an `origin/` prefix
 * from a remote-tracking ref).
 * @param {string} branch
 * @param {string} fixBranch
 * @returns {boolean}
 */
function isFixBranch(branch, fixBranch) {
  return branch === fixBranch || branch === `origin/${fixBranch}`
}

/**
 * Classify one `neutral:fix` issue's fix-attempt state from ground truth. A
 * `neutral:stuck` label wins (a human must look); else an existing `fix/issue-N`
 * branch or `Fixes #N` PR means the attempt exists (resume, never duplicate — step
 * 1); else it still needs a fix.
 * @param {number} issue
 * @param {{branches?: string[], prs?: Array<{number: number, body: string}>, labels?: string[]}} obs
 * @returns {{state: IssueFixState['state'], via?: string}}
 * @ref LLP 0009#issue-fix-reconciler [implements] — idempotent intake
 */
export function classifyIssue(issue, obs) {
  const labels = (obs.labels || []).map(l => String(l).toLowerCase())
  if (labels.includes(STUCK_LABEL)) return { state: 'stuck', via: `label:${STUCK_LABEL}` }

  const fixBranch = fixBranchName(issue)
  if ((obs.branches || []).some(b => isFixBranch(b, fixBranch))) {
    return { state: 'attempt-exists', via: `branch:${fixBranch}` }
  }
  for (const pr of obs.prs || []) {
    if (fixedIssueNumbers(pr.body).includes(issue)) return { state: 'attempt-exists', via: `pr:#${pr.number}` }
  }
  return { state: 'needs-fix' }
}
