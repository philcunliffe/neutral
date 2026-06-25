// @ts-check
// PR-health: the `reconcilePR` rung ladder, as a PURE classifier over observed
// GitHub state. No shell-out — github.js observes, this decides, the skill acts.
// The rungs are strictly ordered (mergeable -> green -> reviewed) and EXACTLY ONE
// is chosen per tick: any push moves the head SHA, so every downstream fact is
// re-derived next tick rather than stacked on a stale read.
// @ref LLP 0009#pr-health-reconciler [implements] — the rung ladder + one-rung-per-tick
import { DEFAULT_REVIEW_ROUNDS } from './config.js'

/** @import { PrObservation, RungDecision } from './types.d.ts' */

// `<!-- neutral-review: <headSha> -->` — the head a review covered, so an unchanged
// head is not re-reviewed every tick and a new head re-opens review.
// @ref LLP 0009#pr-health-reconciler [implements] — head-SHA review marker
const REVIEW_MARKER_RE = /<!--\s*neutral-review:\s*([0-9a-f]{7,40})\s*-->/gi

/**
 * SHAs of every neutral-review marker in a PR body, in document order. The count is
 * the number of review rounds completed; the last is the most recently reviewed head.
 * @param {string} body
 * @returns {string[]}
 */
export function parseReviewMarkers(body) {
  /** @type {string[]} */
  const shas = []
  for (const m of String(body || '').matchAll(REVIEW_MARKER_RE)) shas.push(m[1].toLowerCase())
  return shas
}

/**
 * How many review rounds have completed = how many markers the body carries. Bounds
 * the fix loop (LLP 0009 rung 3): past the cap with the head still unreviewed = stuck.
 * @param {string} body
 * @returns {number}
 */
export function reviewRounds(body) {
  return parseReviewMarkers(body).length
}

/**
 * Two SHAs name the same commit, tolerating abbreviation (a marker may store an
 * abbreviated SHA while `headRefOid` is full-length).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function shaEq(a, b) {
  if (!a || !b) return false
  const x = a.toLowerCase(), y = b.toLowerCase()
  return x === y || x.startsWith(y) || y.startsWith(x)
}

/**
 * True iff the latest review marker covers the current head SHA. A new head (our own
 * fix, or a human's push) leaves no covering marker, re-opening review (LLP 0002:
 * a review of a prior commit is stale).
 * @param {string} body
 * @param {string} headSha
 * @returns {boolean}
 */
export function reviewedAtHead(body, headSha) {
  const shas = parseReviewMarkers(body)
  if (!shas.length || !headSha) return false
  return shaEq(shas[shas.length - 1], headSha)
}

/**
 * Classify the mergeable rung from GitHub's own `mergeable` / `mergeStateStatus`
 * (LLP 0009 rung 1). `UNKNOWN` mergeability is "wait", not failure (LLP 0002:
 * not-yet-observable != false) — acting on it would storm a PR that is fine.
 * @param {string} mergeable        MERGEABLE | CONFLICTING | UNKNOWN
 * @param {string} mergeStateStatus BEHIND | DIRTY | CLEAN | BLOCKED | UNSTABLE | UNKNOWN | ...
 * @returns {'wait'|'resolve-conflict'|'merge-base'|'clean'}
 */
export function classifyMergeable(mergeable, mergeStateStatus) {
  const mg = String(mergeable || '').toUpperCase()
  const ms = String(mergeStateStatus || '').toUpperCase()
  if (mg === 'UNKNOWN') return 'wait'                      // GitHub still computing
  if (ms === 'DIRTY' || mg === 'CONFLICTING') return 'resolve-conflict'
  if (ms === 'BEHIND') return 'merge-base'                 // stale, no conflict
  return 'clean'
}

/**
 * The state of one check in a `statusCheckRollup` entry. A CheckRun carries
 * `status` (+ `conclusion` once COMPLETED); a StatusContext carries `state`.
 * @param {any} c
 * @returns {'SUCCESS'|'FAILURE'|'PENDING'}
 */
function checkState(c) {
  const status = String(c.status || '').toUpperCase()
  const conclusion = String(c.conclusion || '').toUpperCase()
  const state = String(c.state || '').toUpperCase()
  if (status && status !== 'COMPLETED') return 'PENDING'   // CheckRun still running
  if (conclusion) {
    return ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion) ? 'SUCCESS' : 'FAILURE'
  }
  if (state) {
    if (state === 'SUCCESS' || state === 'EXPECTED') return 'SUCCESS'
    if (state === 'PENDING') return 'PENDING'
    return 'FAILURE'                                        // FAILURE, ERROR
  }
  return 'PENDING'                                          // unknown shape — wait, don't fail
}

/**
 * Aggregate a `statusCheckRollup` array to one verdict, read against the current
 * head SHA by the caller (LLP 0002). Any failure dominates; else any pending waits;
 * else green. No checks at all = NONE (nothing to wait for — treated as green).
 * @param {any[]} rollup
 * @returns {'SUCCESS'|'FAILURE'|'PENDING'|'NONE'}
 */
export function rollupConclusion(rollup) {
  const arr = Array.isArray(rollup) ? rollup : []
  if (!arr.length) return 'NONE'
  let pending = false
  for (const c of arr) {
    const s = checkState(c)
    if (s === 'FAILURE') return 'FAILURE'
    if (s === 'PENDING') pending = true
  }
  return pending ? 'PENDING' : 'SUCCESS'
}

/**
 * The single rung action `reconcilePR` takes on a PR this tick. Strictly ordered:
 * there is no point grading checks or a review on a branch that cannot merge, so a
 * lower rung that is not yet satisfied is always chosen first. `wait` rungs are the
 * eventually-consistent cases (LLP 0002): the loop re-observes next tick.
 * @param {PrObservation} pr
 * @param {number} [maxReviewRounds]
 * @returns {RungDecision}
 * @ref LLP 0009#pr-health-reconciler [implements]
 */
export function selectRung(pr, maxReviewRounds = DEFAULT_REVIEW_ROUNDS) {
  // Rung 1 — mergeable.
  const m = classifyMergeable(pr.mergeable, pr.mergeStateStatus)
  if (m === 'wait') return { rung: 'mergeable', action: 'wait', reason: 'mergeability UNKNOWN — GitHub still computing' }
  if (m === 'resolve-conflict') return { rung: 'mergeable', action: 'resolve-conflict', reason: 'DIRTY — real merge conflict (highest blast radius)' }
  if (m === 'merge-base') return { rung: 'mergeable', action: 'merge-base', reason: 'BEHIND — stale base, no conflict; merge target in mechanically' }

  // Rung 2 — green (keyed to the current head SHA).
  const g = rollupConclusion(pr.rollup)
  if (g === 'FAILURE') return { rung: 'green', action: 'fix-ci', reason: 'checks failing at head — fix from the failing logs' }
  if (g === 'PENDING') return { rung: 'green', action: 'wait', reason: 'checks pending at head — wait (no fix-storm mid-run)' }

  // Rung 3 — reviewed (keyed to the current head SHA).
  if (!reviewedAtHead(pr.body, pr.headSha)) {
    if (reviewRounds(pr.body) >= maxReviewRounds) {
      return { rung: 'reviewed', action: 'stuck', reason: `unresolved after ${maxReviewRounds} review round(s) — label neutral:stuck` }
    }
    return { rung: 'reviewed', action: 'review', reason: 'head not yet reviewed — run the review, fix findings, mark the reviewed head' }
  }

  // Terminal — mergeable ∧ green ∧ reviewed: hold for a human, never merge.
  if (pr.isDraft) return { rung: 'terminal', action: 'ready-hold', reason: 'mergeable ∧ green ∧ reviewed — flip ready, then HOLD' }
  return { rung: 'terminal', action: 'held', reason: 'already held for a human — nothing to do' }
}
