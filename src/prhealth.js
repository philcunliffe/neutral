// @ts-check
// PR-health: the `reconcilePR` rung ladder, as a PURE classifier over observed
// GitHub state. No shell-out — github.js observes, this decides, the skill acts.
// The rungs are strictly ordered (mergeable -> green -> reviewed) and EXACTLY ONE
// is chosen per tick: any push moves the head SHA, so every downstream fact is
// re-derived next tick rather than stacked on a stale read.
// @ref LLP 0009#pr-health-reconciler [implements] — the rung ladder + one-rung-per-tick
import { DEFAULT_REVIEW_ROUNDS, STUCK_LABEL } from './config.js'

/** @import { PrObservation, RungDecision } from './types.d.ts' */

// `<!-- neutral-review: <headSha> -->` — the head a review covered, so an unchanged
// head is not re-reviewed every tick and a new head re-opens review.
// @ref LLP 0009#pr-health-reconciler [implements] — head-SHA review marker
const REVIEW_MARKER_RE = /<!--\s*neutral-review:\s*([0-9a-f]{7,40})\s*-->/gi

// `<!-- neutral-triage: <headSha> #M -->` — the head at which the review fix-loop hit
// `maxReviewRounds` and the residual findings were judged non-blocking and DEFERRED to
// follow-up issue #M. Head-keyed exactly like the review marker: an unchanged head reads
// as reviewed (the findings rode off to #M), a new head re-opens review. `#M` is the
// follow-up issue, carried for audit (the SHA is what the predicate keys on).
// @ref LLP 0017 [implements] — triage-at-cap defers non-blockers and ships
const TRIAGE_MARKER_RE = /<!--\s*neutral-triage:\s*([0-9a-f]{7,40})\b[^>]*-->/gi

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
 * SHAs of every neutral-triage marker in a PR body, in document order. Each marks a head
 * at which review rounds were exhausted and the residual findings were deferred to a
 * `neutral:fix` follow-up (LLP 0017).
 * @param {string} body
 * @returns {string[]}
 */
export function parseTriageMarkers(body) {
  /** @type {string[]} */
  const shas = []
  for (const m of String(body || '').matchAll(TRIAGE_MARKER_RE)) shas.push(m[1].toLowerCase())
  return shas
}

/**
 * True iff a triage marker covers the current head SHA — the review fix-loop was exhausted
 * at this head and its residual findings were judged non-blocking and deferred (LLP 0017),
 * so the reviewed rung is satisfied. A new head leaves no covering marker, re-opening
 * review exactly as `reviewedAtHead` does (LLP 0002: a triage of a prior commit is stale).
 * @param {string} body
 * @param {string} headSha
 * @returns {boolean}
 */
export function triagedAtHead(body, headSha) {
  if (!headSha) return false
  return parseTriageMarkers(body).some(sha => shaEq(sha, headSha))
}

// `<!-- neutral-verdict: <sha> approved|changes-requested -->` — the head at which neutral
// posted a verdict on an ADOPTED (foreign) PR (LLP 0025). Head-keyed exactly like the review
// and triage markers: the verdict stands until the *contributor* pushes a new head, which
// re-opens it — base movement alone does not (an adopted PR's ball is out of neutral's court
// once a verdict is posted, unlike an own PR that neutral keeps rebased). Own PRs never carry
// this — they terminate in a ready-hold/merge, not a verdict label.
// @ref LLP 0025#ground-truth [implements] — head-keyed verdict marker for adopted PRs
const VERDICT_MARKER_RE = /<!--\s*neutral-verdict:\s*([0-9a-f]{7,40})\b[^>]*-->/gi

/**
 * SHAs of every neutral-verdict marker in a PR body, in document order (LLP 0025).
 * @param {string} body
 * @returns {string[]}
 */
export function parseVerdictMarkers(body) {
  /** @type {string[]} */
  const shas = []
  for (const m of String(body || '').matchAll(VERDICT_MARKER_RE)) shas.push(m[1].toLowerCase())
  return shas
}

/**
 * True iff a verdict marker covers the current head — neutral already posted its
 * approved/changes-requested verdict for this exact commit, so the loop holds rather than
 * re-labelling a settled head. A contributor push moves the head and re-opens it (LLP 0002:
 * a verdict on a prior commit is stale).
 * @param {string} body
 * @param {string} headSha
 * @returns {boolean}
 */
export function verdictAtHead(body, headSha) {
  if (!headSha) return false
  return parseVerdictMarkers(body).some(sha => shaEq(sha, headSha))
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
 * @param {boolean} [automerge]  opt-in (LLP 0019): terminal = merge, not hold
 * @returns {RungDecision}
 * @ref LLP 0009#pr-health-reconciler [implements]
 */
export function selectRung(pr, maxReviewRounds = DEFAULT_REVIEW_ROUNDS, automerge = false) {
  // Held for a human — wins over every rung. neutral sets `neutral:stuck` when it
  // cannot auto-advance a PR (an unresolved review finding, a design decision it
  // will not guess at, a conflict it backed off). The label is the authorization
  // boundary, exactly as it is for issues (issuefix.js): once set, the loop surfaces
  // the PR and must NOT churn it — re-review/merge-base/fix-ci would all loop forever
  // on a PR a human has been asked to look at. `held` (not `stuck`) because the label
  // already exists; re-emitting `stuck` would re-label and re-comment every tick.
  // @ref LLP 0009#pr-health-reconciler [constrained-by] — neutral:stuck halts auto-advance
  if ((pr.labels || []).includes(STUCK_LABEL)) {
    return { rung: 'terminal', action: 'held', reason: `labeled ${STUCK_LABEL} — held for a human (won't auto-advance)` }
  }

  // Adopted (foreign) PRs — LLP 0025. Same strictly-ordered ladder, but heal actions are gated
  // on push access and the terminal is a verdict LABEL (neutral:approved / :changes-requested),
  // never a ready-flip or merge — readying/merging a contributor's PR is the maintainer's call
  // (LLP 0000 §Autonomy). Own PRs (foreign falsy) fall through to the unchanged ladder below.
  // @ref LLP 0025#the-degraded-rung-ladder [implements]
  if (pr.foreign) return foreignRung(pr, maxReviewRounds)

  // Rung 1 — mergeable.
  const m = classifyMergeable(pr.mergeable, pr.mergeStateStatus)
  if (m === 'wait') return { rung: 'mergeable', action: 'wait', reason: 'mergeability UNKNOWN — GitHub still computing' }
  if (m === 'resolve-conflict') return { rung: 'mergeable', action: 'resolve-conflict', reason: 'DIRTY — real merge conflict (highest blast radius)' }
  if (m === 'merge-base') return { rung: 'mergeable', action: 'merge-base', reason: 'BEHIND — stale base, no conflict; merge target in mechanically' }

  // Rung 2 — green (keyed to the current head SHA).
  const g = rollupConclusion(pr.rollup)
  if (g === 'FAILURE') return { rung: 'green', action: 'fix-ci', reason: 'checks failing at head — fix from the failing logs' }
  if (g === 'PENDING') return { rung: 'green', action: 'wait', reason: 'checks pending at head — wait (no fix-storm mid-run)' }

  // Rung 3 — reviewed (keyed to the current head SHA). A head counts as reviewed by a
  // clean review marker OR a triage marker: at the round cap, residual findings judged
  // non-blocking are deferred to a `neutral:fix` follow-up and the head ships (LLP 0017),
  // so a triage marker satisfies this rung just as a review marker does.
  // @ref LLP 0017 [implements] — triage at the cap replaces a blanket stuck
  if (!reviewedAtHead(pr.body, pr.headSha) && !triagedAtHead(pr.body, pr.headSha)) {
    if (reviewRounds(pr.body) >= maxReviewRounds) {
      return { rung: 'reviewed', action: 'triage', reason: `${maxReviewRounds} review round(s) exhausted — triage residual findings (defer non-blockers to neutral:fix, else neutral:stuck)` }
    }
    return { rung: 'reviewed', action: 'review', reason: 'head not yet reviewed — run the review, fix findings, mark the reviewed head' }
  }

  // Terminal — mergeable ∧ green ∧ reviewed: hold for a human, never merge —
  // unless the repo owner moved that boundary. Automerge changes only this rung:
  // every gate above (fresh-head green, fresh-head review, the stuck override)
  // was already satisfied to get here.
  // @ref LLP 0019 [implements] — opt-in automerge relaxes the hold, never the gates
  if (automerge) return { rung: 'terminal', action: 'merge', reason: 'mergeable ∧ green ∧ reviewed, automerge on — flip ready if draft, then squash-merge' }
  if (pr.isDraft) return { rung: 'terminal', action: 'ready-hold', reason: 'mergeable ∧ green ∧ reviewed — flip ready, then HOLD' }
  return { rung: 'terminal', action: 'held', reason: 'already held for a human — nothing to do' }
}

/**
 * The rung action for an ADOPTED (foreign) PR (LLP 0025). Same strict order as an own PR
 * (mergeable → green → reviewed → terminal), with two differences: heal actions are gated on
 * `canPush` — when neutral cannot push to the fork, an unmet heal rung degrades to
 * `request-changes` (surface the blocker to the contributor) instead of healing it — and the
 * terminal is a verdict label (`approve` → neutral:approved), never a ready-flip or merge.
 * `automerge` is deliberately ignored: neutral never merges a contributor's PR (LLP 0000).
 * @param {PrObservation} pr
 * @param {number} maxReviewRounds
 * @returns {RungDecision}
 * @ref LLP 0025#the-degraded-rung-ladder [implements]
 * @ref LLP 0000#autonomy [constrained-by] — terminal is a verdict, never a merge/ready-flip
 */
function foreignRung(pr, maxReviewRounds) {
  // Absent ⇒ pushable (a same-repo branch). Only a cross-repo fork with maintainer-edits off
  // is unpushable. @ref LLP 0024#decision [constrained-by] — canPush selects the mode, not a gate
  const canPush = pr.canPush !== false

  // A verdict already posted for this exact head → held; a contributor push moves the head and
  // re-opens it (LLP 0002). This idempotency gate keeps the loop from re-labelling a settled
  // head every tick — the foreign counterpart to an own PR's terminal `held`.
  if (verdictAtHead(pr.body, pr.headSha)) {
    return { rung: 'terminal', action: 'held', reason: 'verdict posted for this head — held (a contributor push re-opens)' }
  }

  // Rung 1 — mergeable. Healed in place when pushable, else handed to the contributor.
  const m = classifyMergeable(pr.mergeable, pr.mergeStateStatus)
  if (m === 'wait') return { rung: 'mergeable', action: 'wait', reason: 'mergeability UNKNOWN — GitHub still computing' }
  if (m === 'resolve-conflict') {
    return canPush
      ? { rung: 'mergeable', action: 'resolve-conflict', reason: 'DIRTY — real merge conflict; resolve and push to the fork' }
      : { rung: 'mergeable', action: 'request-changes', reason: 'DIRTY — contributor must resolve (neutral cannot push to this fork)' }
  }
  if (m === 'merge-base') {
    return canPush
      ? { rung: 'mergeable', action: 'merge-base', reason: 'BEHIND — stale base, no conflict; merge target in and push to the fork' }
      : { rung: 'mergeable', action: 'request-changes', reason: 'BEHIND — contributor must rebase (neutral cannot push to this fork)' }
  }

  // Rung 2 — green (keyed to the current head SHA).
  const g = rollupConclusion(pr.rollup)
  if (g === 'FAILURE') {
    return canPush
      ? { rung: 'green', action: 'fix-ci', reason: 'checks failing at head — fix from the logs and push to the fork' }
      : { rung: 'green', action: 'request-changes', reason: 'checks failing at head — contributor must fix (neutral cannot push)' }
  }
  if (g === 'PENDING') return { rung: 'green', action: 'wait', reason: 'checks pending at head — wait (no fix-storm mid-run)' }

  // Rung 3 — reviewed (keyed to the current head SHA). Review always runs — it needs no push.
  // Pushable: findings are fixed in a bounded loop exactly like an own PR, and at the cap the
  // residual is handed to the CONTRIBUTOR (request-changes) rather than deferred to a
  // neutral:fix follow-up — triage (LLP 0017) is an own-PR mechanism (the code is the
  // contributor's here). Review-only: the `review` action posts the verdict directly.
  if (!reviewedAtHead(pr.body, pr.headSha)) {
    if (canPush && reviewRounds(pr.body) >= maxReviewRounds) {
      return { rung: 'reviewed', action: 'request-changes', reason: `${maxReviewRounds} review round(s) exhausted — hand residual findings to the contributor (neutral:changes-requested)` }
    }
    return { rung: 'reviewed', action: 'review', reason: 'head not reviewed — review; approve if clean, else request changes' }
  }

  // Terminal — mergeable ∧ green ∧ reviewed, no verdict yet at this head: approve and hold the
  // verdict for the maintainer. Never a merge or a ready-flip (LLP 0000 §Autonomy).
  // @ref LLP 0025#terminal-a-verdict-label-not-a-merge [implements]
  return { rung: 'terminal', action: 'approve', reason: 'mergeable ∧ green ∧ reviewed — set neutral:approved, hold for the maintainer to merge' }
}
