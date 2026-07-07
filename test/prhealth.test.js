// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectRung, classifyMergeable, rollupConclusion,
  parseReviewMarkers, reviewRounds, reviewedAtHead,
  parseTriageMarkers, triagedAtHead,
  parseVerdictMarkers, verdictAtHead
} from '../src/prhealth.js'

/**
 * A minimal mergeable+green PR observation, overridable per test.
 * @param {Partial<import('../src/types.d.ts').PrObservation>} over
 * @returns {import('../src/types.d.ts').PrObservation}
 */
function pr(over = {}) {
  return {
    number: 1, head: 'integration/x', base: 'main', isDraft: true,
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', rollup: [], headSha: 'abc1234', body: '', labels: [],
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

test('review markers: parse all SHAs, count rounds, match the latest against head', () => {
  const body = 'work\n<!-- neutral-review: aaaa111 -->\nmore\n<!-- neutral-review: bbbb222 -->\n'
  assert.deepEqual(parseReviewMarkers(body), ['aaaa111', 'bbbb222'])
  assert.equal(reviewRounds(body), 2)
  assert.equal(reviewRounds(''), 0)
  // latest marker (bbbb222) must cover head; an abbreviation still matches the full oid
  assert.equal(reviewedAtHead(body, 'bbbb222'), true)
  assert.equal(reviewedAtHead(body, 'bbbb2220000000000000000000000000000000ff'), true)
  assert.equal(reviewedAtHead(body, 'aaaa111'), false) // an older head is stale
  assert.equal(reviewedAtHead('', 'bbbb222'), false)
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
  assert.equal(selectRung(pr({ labels: ['neutral:stuck'], body, headSha: 'abc1234' }), 2, AUTOMERGE).action, 'held')
})

test('selectRung: neutral:stuck label is held for a human and wins over every rung', () => {
  // A PR neutral gave up on (conflicting, failing, unreviewed) is still HELD, not
  // churned — the label is the authorization boundary, just like for issues.
  assert.deepEqual(
    pick(selectRung(pr({ labels: ['neutral:stuck'], mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', rollup: [{ state: 'FAILURE' }] }))),
    { rung: 'terminal', action: 'held' }
  )
  // A PR that would otherwise be 'review' (unreviewed head) is held while labelled...
  assert.equal(selectRung(pr({ labels: ['neutral:stuck'], headSha: 'abc1234' })).action, 'held')
  // ...and the SAME PR without the label is reviewed as normal (the label is the only difference).
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

test('foreign PR still respects neutral:stuck — held over every rung (LLP 0009/0025)', () => {
  assert.equal(selectRung(fpr({ labels: ['neutral:stuck'], mergeStateStatus: 'BEHIND' })).action, 'held')
})

/** @param {import('../src/types.d.ts').RungDecision} d */
function pick(d) { return { rung: d.rung, action: d.action } }
