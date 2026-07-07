// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectRung, classifyMergeable, rollupConclusion,
  parseReviewMarkers, reviewRecords, reviewRounds, reviewedAtHead,
  parseTriageMarkers, triagedAtHead,
  parseVerdictMarkers, verdictAtHead,
  latestStuckReport, isHumanComment, humanRepliesAfterStuckReport
} from '../src/prhealth.js'

/**
 * A minimal mergeable+green PR observation, overridable per test.
 * @param {Partial<import('../src/types.d.ts').PrObservation>} over
 * @returns {import('../src/types.d.ts').PrObservation}
 */
function pr(over = {}) {
  return {
    number: 1, head: 'integration/x', base: 'main', isDraft: true,
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', rollup: [], headSha: 'abc1234', body: '', labels: [], comments: [],
    ...over
  }
}

test('classifyMergeable: UNKNOWN waits, DIRTY/CONFLICTING resolves, BEHIND merges base, else clean', () => {
  assert.equal(classifyMergeable('UNKNOWN', 'UNKNOWN'), 'wait')
  assert.equal(classifyMergeable('CONFLICTING', 'DIRTY'), 'resolve-conflict')
  assert.equal(classifyMergeable('MERGEABLE', 'DIRTY'), 'resolve-conflict')
  assert.equal(classifyMergeable('MERGEABLE', 'BEHIND'), 'merge-base')
  assert.equal(classifyMergeable('MERGEABLE', 'CLEAN'), 'clean')
  assert.equal(classifyMergeable('MERGEABLE', 'BLOCKED'), 'clean') // blocked-by-policy is still conflict-free
})

test('rollupConclusion: empty is NONE, any failure dominates, else pending, else success', () => {
  assert.equal(rollupConclusion([]), 'NONE')
  assert.equal(rollupConclusion([{ status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'SUCCESS')
  assert.equal(rollupConclusion([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]), 'PENDING')
  assert.equal(rollupConclusion([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }]), 'FAILURE')
  // StatusContext shape (state, not status/conclusion)
  assert.equal(rollupConclusion([{ state: 'SUCCESS' }]), 'SUCCESS')
  assert.equal(rollupConclusion([{ state: 'PENDING' }]), 'PENDING')
  assert.equal(rollupConclusion([{ state: 'ERROR' }]), 'FAILURE')
  // NEUTRAL/SKIPPED do not block; CANCELLED is treated as a failure to surface
  assert.equal(rollupConclusion([{ status: 'COMPLETED', conclusion: 'SKIPPED' }]), 'SUCCESS')
  assert.equal(rollupConclusion([{ status: 'COMPLETED', conclusion: 'CANCELLED' }]), 'FAILURE')
})

test('review records: markers parse with verdicts; bare (legacy) markers read clean (LLP 0028/0029)', () => {
  const body = 'work\n<!-- neutral-review: aaaa111 -->\nmore\n<!-- neutral-review: bbbb222 -->\n'
  assert.deepEqual(parseReviewMarkers(body), [
    { sha: 'aaaa111', clean: true }, { sha: 'bbbb222', clean: true }
  ])
  assert.deepEqual(
    parseReviewMarkers('<!-- neutral-review: cccc333 findings -->\n<!-- neutral-review: dddd444 clean -->'),
    [{ sha: 'cccc333', clean: false }, { sha: 'dddd444', clean: true }]
  )
})

test('review records: body legacy rounds first, then comment records in thread order (LLP 0028)', () => {
  const body = 'work\n<!-- neutral-review: aaaa111 -->\nmore\n<!-- neutral-review: bbbb222 -->\n'
  const comments = [
    { author: 'phil', body: '<!-- neutral-review: cccc333 findings -->\nround 3: blocker at x.js:1', createdAt: '1' },
    { author: 'phil', body: 'no marker — not a record', createdAt: '2' }
  ]
  assert.deepEqual(reviewRecords(body, comments).map(r => r.sha), ['aaaa111', 'bbbb222', 'cccc333'])
  assert.equal(reviewRounds(body, comments), 3)
  assert.equal(reviewRounds(body), 2) // comments optional — body alone still counts
  assert.equal(reviewRounds('', []), 0)
})

test('reviewedAtHead: the latest record must cover head AND be clean (LLP 0029)', () => {
  const body = 'work\n<!-- neutral-review: aaaa111 -->\nmore\n<!-- neutral-review: bbbb222 -->\n'
  // legacy body markers still satisfy — an already-reviewed head does not re-open...
  assert.equal(reviewedAtHead(body, [], 'bbbb222'), true)
  assert.equal(reviewedAtHead(body, [], 'bbbb2220000000000000000000000000000000ff'), true) // abbrev matches full oid
  assert.equal(reviewedAtHead(body, [], 'aaaa111'), false) // an older head is stale
  assert.equal(reviewedAtHead('', [], 'bbbb222'), false)
  // ...a clean comment record satisfies; a findings record at the SAME head does not —
  // it is a counted, unsatisfied round (marking it reviewed would flip a blocked PR terminal)
  const clean = [{ author: 'phil', body: '<!-- neutral-review: beef999 clean -->\nlgtm', createdAt: '1' }]
  const findings = [{ author: 'phil', body: '<!-- neutral-review: beef999 findings -->\nblocker at y.js:9', createdAt: '1' }]
  assert.equal(reviewedAtHead('', clean, 'beef999'), true)
  assert.equal(reviewedAtHead('', findings, 'beef999'), false)
})

test('selectRung: an unfixable head reaches triage at the cap instead of re-reviewing forever (LLP 0029)', () => {
  // The churn this fixes: a blocked round left NO record, so the same head was
  // re-reviewed every tick and maxReviewRounds never tripped. Verdict-carrying
  // records count blocked rounds too.
  const round1 = [{ author: 'phil', body: '<!-- neutral-review: beef999 findings -->\nblocker', createdAt: '1' }]
  assert.equal(selectRung(pr({ headSha: 'beef999', comments: round1 })).action, 'review') // round 2 may still fix it
  const round2 = [...round1, { author: 'phil', body: '<!-- neutral-review: beef999 findings -->\nstill blocked', createdAt: '2' }]
  assert.equal(selectRung(pr({ headSha: 'beef999', comments: round2 })).action, 'triage')
})

test('selectRung: a clean comment record at head is terminal; a marker-signed review never reads human (LLP 0028)', () => {
  const clean = [{ author: 'phil', body: '<!-- neutral-review: abc1234 clean -->\nlgtm', createdAt: '1' }]
  assert.equal(selectRung(pr({ headSha: 'abc1234', comments: clean, isDraft: true })).action, 'ready-hold')
  // the record carries a neutral marker, so it can never falsely unstick a held PR (LLP 0027)
  assert.equal(isHumanComment(clean[0]), false)
})

test('selectRung climbs strictly: a lower unmet rung is always chosen first', () => {
  // mergeable rung dominates even when checks are red and head is unreviewed
  assert.deepEqual(
    selectRung(pr({ mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', rollup: [{ state: 'FAILURE' }] })).rung,
    'mergeable'
  )
  assert.equal(selectRung(pr({ mergeStateStatus: 'BEHIND' })).action, 'merge-base')
  assert.equal(selectRung(pr({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' })).action, 'wait')
})

test('selectRung green rung: failure -> fix-ci, pending -> wait', () => {
  assert.deepEqual(
    { rung: 'green', action: 'fix-ci' },
    pick(selectRung(pr({ rollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })))
  )
  assert.deepEqual(
    { rung: 'green', action: 'wait' },
    pick(selectRung(pr({ rollup: [{ status: 'IN_PROGRESS' }] })))
  )
})

test('selectRung reviewed rung: review when head unreviewed, triage past the round cap', () => {
  // green (no checks) + draft + no review marker -> review
  assert.equal(selectRung(pr({ headSha: 'abc1234' })).action, 'review')
  // two prior rounds, head still unreviewed -> triage (residual findings judged before
  // a blanket stuck — LLP 0017; SHAs must be valid hex)
  const body = '<!-- neutral-review: abc0001 -->\n<!-- neutral-review: abc0002 -->'
  assert.equal(selectRung(pr({ headSha: 'beef999', body })).action, 'triage')
  // a custom round cap is honoured
  assert.equal(selectRung(pr({ headSha: 'beef999', body: '<!-- neutral-review: abc0001 -->' }), 1).action, 'triage')
})

test('triage markers: parse all SHAs, match any against head, ignore the #issue suffix', () => {
  const body = 'review\n<!-- neutral-review: abc0001 -->\ntriage\n<!-- neutral-triage: beef999 #42 -->\n'
  assert.deepEqual(parseTriageMarkers(body), ['beef999'])
  assert.deepEqual(parseTriageMarkers(''), [])
  // a triage marker covering head satisfies the reviewed rung even with an issue suffix
  assert.equal(triagedAtHead(body, 'beef999'), true)
  assert.equal(triagedAtHead(body, 'beef9990000000000000000000000000000000ff'), true)
  assert.equal(triagedAtHead(body, 'abc0001'), false) // a review marker is not a triage marker
  assert.equal(triagedAtHead('', 'beef999'), false)
})

test('selectRung reviewed rung: a triage marker at head satisfies the rung (LLP 0017)', () => {
  // residual findings were deferred at this head -> terminal, never re-triaged
  const body = '<!-- neutral-review: abc0001 -->\n<!-- neutral-review: abc0002 -->\n<!-- neutral-triage: beef999 #7 -->'
  assert.equal(selectRung(pr({ headSha: 'beef999', body, isDraft: true })).action, 'ready-hold')
  assert.equal(selectRung(pr({ headSha: 'beef999', body, isDraft: false })).action, 'held')
  // ...the marker is head-keyed: a new head leaves it stale, so the PR is no longer
  // terminal. The round cap is a lifetime budget (the markers persist), so the fresh head
  // re-enters triage rather than burning a new review round.
  assert.equal(selectRung(pr({ headSha: 'cafe123', body })).action, 'triage')
})

test('selectRung terminal: ready-hold a reviewed draft, held once already ready — never merge', () => {
  const body = '<!-- neutral-review: abc1234 -->'
  assert.equal(selectRung(pr({ headSha: 'abc1234', body, isDraft: true })).action, 'ready-hold')
  assert.equal(selectRung(pr({ headSha: 'abc1234', body, isDraft: false })).action, 'held')
})

test('selectRung terminal with automerge on: merge instead of hold, gates unchanged (LLP 0019)', () => {
  const body = '<!-- neutral-review: abc1234 -->'
  const AUTOMERGE = true
  // draft and already-ready both merge — the skill flips ready first when needed
  assert.deepEqual(
    pick(selectRung(pr({ headSha: 'abc1234', body, isDraft: true }), 2, AUTOMERGE)),
    { rung: 'terminal', action: 'merge' }
  )
  assert.equal(selectRung(pr({ headSha: 'abc1234', body, isDraft: false }), 2, AUTOMERGE).action, 'merge')
  // automerge relaxes only the hold: an unmet lower rung is still chosen first...
  assert.equal(selectRung(pr({ headSha: 'beef999', body }), 2, AUTOMERGE).action, 'review')       // stale review
  assert.equal(selectRung(pr({ mergeStateStatus: 'BEHIND', body, headSha: 'abc1234' }), 2, AUTOMERGE).action, 'merge-base')
  assert.equal(selectRung(pr({ rollup: [{ status: 'IN_PROGRESS' }], body, headSha: 'abc1234' }), 2, AUTOMERGE).action, 'wait')
  // ...and neutral:stuck still wins — a human-held PR is never automerged.
  const reported = [{ author: 'phil', body: '<!-- neutral-stuck: abc1234 -->\nstuck report', createdAt: '2026-07-07T10:00:00Z' }]
  assert.equal(selectRung(pr({ labels: ['neutral:stuck'], body, headSha: 'abc1234', comments: reported }), 2, AUTOMERGE).action, 'held')
})

// One report comment at the given SHA — the thread baseline for the stuck tests.
/** @param {string} sha */
function report(sha) {
  return { author: 'phil', body: `<!-- neutral-stuck: ${sha} -->\nStuck: needs a design call.`, createdAt: '2026-07-07T10:00:00Z' }
}

test('selectRung: neutral:stuck wins over every rung — no report yet asks for one, else held', () => {
  // A PR neutral gave up on (conflicting, failing, unreviewed) is never churned —
  // the label is the authorization boundary, just like for issues. With no
  // marker-signed report in the thread, the one action owed is posting it (LLP 0026)...
  assert.deepEqual(
    pick(selectRung(pr({ labels: ['neutral:stuck'], mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', rollup: [{ state: 'FAILURE' }] }))),
    { rung: 'terminal', action: 'stuck-report' }
  )
  // ...and once the report covers the thread, the PR is held (report posted, monitoring).
  assert.deepEqual(
    pick(selectRung(pr({ labels: ['neutral:stuck'], comments: [report('abc1234')] }))),
    { rung: 'terminal', action: 'held' }
  )
  // The SAME PR without the label climbs the ladder as normal (the label is the only difference).
  assert.equal(selectRung(pr({ headSha: 'abc1234' })).action, 'review')
})

// --- Adopted (foreign) PRs — LLP 0025 -----------------------------------------------------

/** A foreign (adopted) PR observation: mergeable+green by default, overridable. */
function fpr(over = {}) { return pr({ foreign: true, canPush: true, head: 'contrib/patch', ...over }) }

test('foreign PR (canPush): heals like an own PR but terminal is a verdict, not ready/merge (LLP 0025)', () => {
  // heal rungs are identical to an own PR when neutral can push to the fork
  assert.equal(selectRung(fpr({ mergeStateStatus: 'BEHIND' })).action, 'merge-base')
  assert.equal(selectRung(fpr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })).action, 'resolve-conflict')
  assert.equal(selectRung(fpr({ rollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })).action, 'fix-ci')
  assert.equal(selectRung(fpr({ rollup: [{ status: 'IN_PROGRESS' }] })).action, 'wait')
  assert.equal(selectRung(fpr({ headSha: 'abc1234' })).action, 'review') // unreviewed head
  // reviewed ∧ mergeable ∧ green -> APPROVE (verdict label), never ready-hold/merge...
  const body = '<!-- neutral-review: abc1234 -->'
  assert.deepEqual(pick(selectRung(fpr({ headSha: 'abc1234', body }))), { rung: 'terminal', action: 'approve' })
  // ...and automerge never applies to a contributor's PR (LLP 0000 §Autonomy)
  assert.equal(selectRung(fpr({ headSha: 'abc1234', body }), 2, true).action, 'approve')
})

test('foreign PR at the review cap hands residual findings to the contributor, not triage (LLP 0025)', () => {
  const body = '<!-- neutral-review: abc0001 -->\n<!-- neutral-review: abc0002 -->'
  assert.equal(selectRung(fpr({ headSha: 'beef999', body })).action, 'request-changes')
  // comment records count the same rounds on a foreign PR (LLP 0028 — reuse unchanged)
  const comments = [
    { author: 'phil', body: '<!-- neutral-review: abc0001 findings -->\nr1', createdAt: '1' },
    { author: 'phil', body: '<!-- neutral-review: abc0002 findings -->\nr2', createdAt: '2' }
  ]
  assert.equal(selectRung(fpr({ headSha: 'beef999', comments })).action, 'request-changes')
  // and a clean record at head is the reviewed rung satisfied -> approve
  const clean = [{ author: 'phil', body: '<!-- neutral-review: abc1234 clean -->\nlgtm', createdAt: '1' }]
  assert.deepEqual(pick(selectRung(fpr({ headSha: 'abc1234', comments: clean }))), { rung: 'terminal', action: 'approve' })
})

test('foreign PR (review-only, !canPush): heal rungs degrade to request-changes (LLP 0025)', () => {
  const ro = (over = {}) => fpr({ canPush: false, ...over })
  assert.equal(selectRung(ro({ mergeStateStatus: 'BEHIND' })).action, 'request-changes')
  assert.equal(selectRung(ro({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })).action, 'request-changes')
  assert.equal(selectRung(ro({ rollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })).action, 'request-changes')
  // pending still waits (LLP 0002); review still runs — it needs no push
  assert.equal(selectRung(ro({ rollup: [{ status: 'IN_PROGRESS' }] })).action, 'wait')
  assert.equal(selectRung(ro({ headSha: 'abc1234' })).action, 'review')
  // the review cap is an own-PR fix-loop bound; review-only never fixes, so it reviews, not request-changes
  const twoRounds = '<!-- neutral-review: abc0001 -->\n<!-- neutral-review: abc0002 -->'
  assert.equal(selectRung(ro({ headSha: 'beef999', body: twoRounds })).action, 'review')
})

test('verdict markers: parse SHAs, match head; a verdict holds until the contributor pushes (LLP 0025)', () => {
  const body = 'reviewed\n<!-- neutral-verdict: beef999 approved -->'
  assert.deepEqual(parseVerdictMarkers(body), ['beef999'])
  assert.deepEqual(parseVerdictMarkers(''), [])
  assert.equal(verdictAtHead(body, 'beef999'), true)
  assert.equal(verdictAtHead(body, 'beef9990000000000000000000000000000000ff'), true) // abbrev matches full oid
  assert.equal(verdictAtHead('', 'beef999'), false)
  // a verdict covering head short-circuits to held — even a BEHIND base does not re-open it...
  assert.equal(selectRung(fpr({ canPush: false, headSha: 'beef999', mergeStateStatus: 'BEHIND', body })).action, 'held')
  // ...but a new head (the contributor pushed) leaves the marker stale and re-opens the ladder
  assert.equal(selectRung(fpr({ canPush: false, headSha: 'cafe123', mergeStateStatus: 'BEHIND', body })).action, 'request-changes')
})

test('foreign PR still respects neutral:stuck — the stuck classifier wins over the foreign ladder (LLP 0025/0026)', () => {
  // stuck + a report posted at head + no reply -> held, never a foreign heal/verdict action
  assert.equal(selectRung(fpr({ labels: ['neutral:stuck'], mergeStateStatus: 'BEHIND', comments: [report('abc1234')] })).action, 'held')
  // stuck with no report yet -> stuck-report first (still not a foreign heal)
  assert.equal(selectRung(fpr({ labels: ['neutral:stuck'], mergeStateStatus: 'BEHIND' })).action, 'stuck-report')
})

test('stuck report parsing: latest marker wins; human replies exclude neutral and bot comments', () => {
  const thread = [
    { author: 'phil', body: 'early human chatter', createdAt: '1' },
    report('aaa0001'),
    { author: 'phil', body: 'answered round one', createdAt: '3' },
    report('bbb0002'), // re-stick: fresh report advances the baseline past consumed replies
    { author: 'phil', body: '<!-- neutral-ack -->\nRe-engaging…', createdAt: '5' }, // neutral's own
    { author: 'codecov[bot]', body: 'coverage 98%', createdAt: '6' },               // a bot
    { author: 'phil', body: 'use option B', createdAt: '7' }                        // the signal
  ]
  assert.deepEqual(latestStuckReport(thread), { index: 3, sha: 'bbb0002' })
  assert.equal(latestStuckReport([]), null)
  assert.equal(isHumanComment(thread[4]), false) // marker-signed = neutral's own
  assert.equal(isHumanComment(thread[5]), false) // [bot]
  assert.equal(isHumanComment(thread[6]), true)
  // only the reply AFTER the latest report counts — round-one's answer was consumed
  assert.deepEqual(humanRepliesAfterStuckReport(thread).map(c => c.body), ['use option B'])
  // no report at all -> no baseline -> no replies (a labelled PR owes stuck-report first)
  assert.deepEqual(humanRepliesAfterStuckReport([{ author: 'phil', body: 'hi', createdAt: '1' }]), [])
})

test('selectRung stuck: a human reply after the report — or a moved head — unsticks (LLP 0027)', () => {
  const stuck = { labels: ['neutral:stuck'], headSha: 'abc1234' }
  // report posted, no reply yet -> held (monitoring)
  assert.equal(selectRung(pr({ ...stuck, comments: [report('abc1234')] })).action, 'held')
  // a human reply after the report -> unstick
  assert.deepEqual(
    pick(selectRung(pr({ ...stuck, comments: [report('abc1234'), { author: 'phil', body: 'go with option B', createdAt: '2' }] }))),
    { rung: 'terminal', action: 'unstick' }
  )
  // neutral's own marker-signed comment and a bot's do NOT unstick
  assert.equal(selectRung(pr({ ...stuck, comments: [report('abc1234'), { author: 'phil', body: '<!-- neutral-ack -->\nack', createdAt: '2' }] })).action, 'held')
  assert.equal(selectRung(pr({ ...stuck, comments: [report('abc1234'), { author: 'ci[bot]', body: 'build passed', createdAt: '2' }] })).action, 'held')
  // a head that moved since the report is a human's push -> unstick (neutral never pushes a held PR)
  assert.equal(selectRung(pr({ ...stuck, comments: [report('beef999')] })).action, 'unstick')
  // ...tolerating SHA abbreviation, like the review markers
  assert.equal(selectRung(pr({ ...stuck, headSha: 'abc12340000000000000000000000000000000ff', comments: [report('abc1234')] })).action, 'held')
})

/** @param {import('../src/types.d.ts').RungDecision} d */
function pick(d) { return { rung: d.rung, action: d.action } }
