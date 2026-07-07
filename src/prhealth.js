// @ts-check
// PR-health: the `reconcilePR` rung ladder, as a PURE classifier over observed
// GitHub state. No shell-out — github.js observes, this decides, the skill acts.
// The rungs are strictly ordered (mergeable -> green -> reviewed) and EXACTLY ONE
// is chosen per tick: any push moves the head SHA, so every downstream fact is
// re-derived next tick rather than stacked on a stale read.
// @ref LLP 0009#pr-health-reconciler [implements] — the rung ladder + one-rung-per-tick
import { DEFAULT_REVIEW_ROUNDS, STUCK_LABEL } from './config.js'

/** @import { PrObservation, PrComment, ReviewRecord, RungDecision } from './types.d.ts' */

// `<!-- neutral-review: <headSha> <clean|findings> -->` — one review ROUND. The record
// is a marker-signed COMMENT (LLP 0028): the comment is the round — no comment, no
// round, so a review cannot count without leaving the human-readable evidence — and
// the verdict word decides whether the round *satisfies* the rung (LLP 0029): `clean`
// covers the head; `findings` counts toward the cap without covering it. A bare
// marker (no verdict) reads as `clean` — the legacy body form, which was only ever
// written on success and is still parsed so already-reviewed heads do not re-open.
// @ref LLP 0028 [implements] — the review record is a marker-signed comment
// @ref LLP 0029 [implements] — verdict-carrying rounds; a blocked round still counts
const REVIEW_MARKER_RE = /<!--\s*neutral-review:\s*([0-9a-f]{7,40})(?:\s+(clean|findings))?\s*-->/gi

// `<!-- neutral-triage: <headSha> #M -->` — the head at which the review fix-loop hit
// `maxReviewRounds` and the residual findings were judged non-blocking and DEFERRED to
// follow-up issue #M. Head-keyed exactly like the review marker: an unchanged head reads
// as reviewed (the findings rode off to #M), a new head re-opens review. `#M` is the
// follow-up issue, carried for audit (the SHA is what the predicate keys on).
// @ref LLP 0017 [implements] — triage-at-cap defers non-blockers and ships
const TRIAGE_MARKER_RE = /<!--\s*neutral-triage:\s*([0-9a-f]{7,40})\b[^>]*-->/gi

// `<!-- neutral-stuck: <headSha> -->` — signs the STUCK REPORT comment (LLP 0026): the
// full situation description posted when `neutral:stuck` is set. Lives in the comment
// THREAD, not the body — the human's response channel — and is the baseline the unstick
// predicate reads against: replies after the latest report re-engage the PR (LLP 0027).
// @ref LLP 0026 [implements] — the marker-signed stuck report
const STUCK_MARKER_RE = /<!--\s*neutral-stuck:\s*([0-9a-f]{7,40})\s*-->/i

// Any `<!-- neutral-… -->` marker identifies a comment as neutral's OWN. Neutral posts
// through the repo owner's gh auth, so author identity cannot tell neutral from the
// human — the marker is the discriminator, and every comment neutral posts carries one.
// @ref LLP 0027 [constrained-by] — human replies are recognised by the marker's absence
const NEUTRAL_COMMENT_RE = /<!--\s*neutral-[a-z]+\b/i

/**
 * Every review record in one text, in document order: the head each round covered and
 * whether it was clean (LLP 0029 — a bare marker reads clean, the legacy semantics).
 * @param {string} text
 * @returns {ReviewRecord[]}
 */
export function parseReviewMarkers(text) {
  /** @type {ReviewRecord[]} */
  const records = []
  for (const m of String(text || '').matchAll(REVIEW_MARKER_RE)) {
    records.push({ sha: m[1].toLowerCase(), clean: m[2] !== 'findings' })
  }
  return records
}

/**
 * All review records for a PR, in round order: legacy body markers first (they
 * predate LLP 0028 and were only written on success, so they read clean), then the
 * marker-signed comments in thread order — the record proper (LLP 0028: the comment
 * IS the round). Relies on gh returning comments in chronological order.
 * @param {string} body
 * @param {PrComment[]} [comments]
 * @returns {ReviewRecord[]}
 * @ref LLP 0028 [implements] — records derive from the thread; the body is legacy-read
 */
export function reviewRecords(body, comments) {
  const records = parseReviewMarkers(body)
  const arr = Array.isArray(comments) ? comments : []
  for (const c of arr) records.push(...parseReviewMarkers(c && c.body || ''))
  return records
}

/**
 * How many review rounds have completed = how many records the PR carries, clean or
 * findings alike (LLP 0029 — a bound that only counted successes could not bound the
 * unfixable-findings loop). Bounds the fix loop (LLP 0009 rung 3): past the cap with
 * the head still unreviewed = triage.
 * @param {string} body
 * @param {PrComment[]} [comments]
 * @returns {number}
 */
export function reviewRounds(body, comments) {
  return reviewRecords(body, comments).length
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
 * True iff the latest review record covers the current head SHA AND was clean. A new
 * head (our own fix, or a human's push) leaves no covering record, re-opening review
 * (LLP 0002: a review of a prior commit is stale); a `findings` record at the head is
 * a counted round that does NOT satisfy the rung (LLP 0029 — marking a blocked head
 * reviewed would flip it falsely terminal).
 * @param {string} body
 * @param {PrComment[]} comments
 * @param {string} headSha
 * @returns {boolean}
 */
export function reviewedAtHead(body, comments, headSha) {
  const records = reviewRecords(body, comments)
  if (!records.length || !headSha) return false
  const last = records[records.length - 1]
  return last.clean && shaEq(last.sha, headSha)
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
 * The latest stuck report in a comment thread (LLP 0026): the last comment carrying a
 * `neutral-stuck` marker, with the head SHA it recorded at stick time. Null when the
 * thread has no report — a labelled PR without one owes a `stuck-report` action.
 * @param {PrComment[]} comments
 * @returns {{index: number, sha: string} | null}
 * @ref LLP 0026 [implements]
 */
export function latestStuckReport(comments) {
  const arr = Array.isArray(comments) ? comments : []
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = String(arr[i]?.body || '').match(STUCK_MARKER_RE)
    if (m) return { index: i, sha: m[1].toLowerCase() }
  }
  return null
}

/**
 * True iff a comment counts as a HUMAN reply: not neutral's own (no `<!-- neutral-… -->`
 * marker — the discriminator, since neutral posts as the repo owner's account) and not
 * a bot's (login ends `[bot]` — CI chatter must not unstick a PR).
 * @param {PrComment} c
 * @returns {boolean}
 * @ref LLP 0027 [implements] — what counts as the human's say-so
 */
export function isHumanComment(c) {
  if (!c) return false
  if (NEUTRAL_COMMENT_RE.test(String(c.body || ''))) return false
  if (/\[bot\]$/i.test(String(c.author || ''))) return false
  return true
}

/**
 * The human replies posted AFTER the latest stuck report — the ground-truth unstick
 * signal (LLP 0027). Empty when there is no report (no baseline to read against) or
 * no qualifying reply yet. Relies on gh returning comments in chronological order.
 * @param {PrComment[]} comments
 * @returns {PrComment[]}
 * @ref LLP 0027 [implements]
 */
export function humanRepliesAfterStuckReport(comments) {
  const report = latestStuckReport(comments)
  if (!report) return []
  return (comments || []).slice(report.index + 1).filter(isHumanComment)
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
  // on a PR a human has been asked to look at. But the hold is no longer a dead end:
  // it is a three-way classifier over the comment thread (LLP 0026/0027) —
  //   no stuck report yet      → `stuck-report` (post the full situation comment;
  //                              also heals a crash between label and comment, and
  //                              retrofits PRs stuck before the report existed)
  //   human replied / pushed   → `unstick` (the human's say-so, read from ground
  //                              truth: a non-neutral, non-bot comment after the
  //                              latest report, or a head that moved since it —
  //                              neutral never pushes a held PR)
  //   otherwise                → `held` (report posted, monitoring the thread)
  // @ref LLP 0009#pr-health-reconciler [constrained-by] — neutral:stuck halts auto-advance
  // @ref LLP 0027 [implements] — the conditional hold: a reply re-engages the ladder
  if ((pr.labels || []).includes(STUCK_LABEL)) {
    const report = latestStuckReport(pr.comments || [])
    if (!report) {
      return { rung: 'terminal', action: 'stuck-report', reason: `labeled ${STUCK_LABEL} with no stuck report in the thread — post the full marker-signed situation report (LLP 0026)` }
    }
    const replies = humanRepliesAfterStuckReport(pr.comments || [])
    if (replies.length) {
      return { rung: 'terminal', action: 'unstick', reason: `${replies.length} human repl${replies.length === 1 ? 'y' : 'ies'} since the stuck report — remove ${STUCK_LABEL}, ack, and re-run the rungs with the guidance (LLP 0027)` }
    }
    if (pr.headSha && !shaEq(report.sha, pr.headSha)) {
      return { rung: 'terminal', action: 'unstick', reason: `head moved since the stuck report (${report.sha} → ${pr.headSha}) — a human pushed; remove ${STUCK_LABEL} and re-run the rungs (LLP 0027)` }
    }
    return { rung: 'terminal', action: 'held', reason: `labeled ${STUCK_LABEL} — held for a human (stuck report posted; monitoring the thread for replies)` }
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
  // clean review record in the thread (LLP 0028/0029; legacy body markers still read)
  // OR a triage marker: at the round cap, residual findings judged non-blocking are
  // deferred to a `neutral:fix` follow-up and the head ships (LLP 0017), so a triage
  // marker satisfies this rung just as a clean review record does.
  // @ref LLP 0017 [implements] — triage at the cap replaces a blanket stuck
  if (!reviewedAtHead(pr.body, pr.comments, pr.headSha) && !triagedAtHead(pr.body, pr.headSha)) {
    if (reviewRounds(pr.body, pr.comments) >= maxReviewRounds) {
      return { rung: 'reviewed', action: 'triage', reason: `${maxReviewRounds} review round(s) exhausted — triage residual findings (defer non-blockers to neutral:fix, else neutral:stuck)` }
    }
    return { rung: 'reviewed', action: 'review', reason: 'head not yet reviewed — run the review, fix findings, post the marker-signed review record comment' }
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
  if (!reviewedAtHead(pr.body, pr.comments, pr.headSha)) {
    if (canPush && reviewRounds(pr.body, pr.comments) >= maxReviewRounds) {
      return { rung: 'reviewed', action: 'request-changes', reason: `${maxReviewRounds} review round(s) exhausted — hand residual findings to the contributor (neutral:changes-requested)` }
    }
    return { rung: 'reviewed', action: 'review', reason: 'head not reviewed — review; approve if clean, else request changes' }
  }

  // Terminal — mergeable ∧ green ∧ reviewed, no verdict yet at this head: approve and hold the
  // verdict for the maintainer. Never a merge or a ready-flip (LLP 0000 §Autonomy).
  // @ref LLP 0025#terminal-a-verdict-label-not-a-merge [implements]
  return { rung: 'terminal', action: 'approve', reason: 'mergeable ∧ green ∧ reviewed — set neutral:approved, hold for the maintainer to merge' }
}
