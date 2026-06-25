// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectRung, classifyMergeable, rollupConclusion,
  parseReviewMarkers, reviewRounds, reviewedAtHead
} from '../src/prhealth.js'

/**
 * A minimal mergeable+green PR observation, overridable per test.
 * @param {Partial<import('../src/types.d.ts').PrObservation>} over
 * @returns {import('../src/types.d.ts').PrObservation}
 */
function pr(over = {}) {
  return {
    number: 1, head: 'integration/x', base: 'main', isDraft: true,
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', rollup: [], headSha: 'abc1234', body: '',
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

test('selectRung reviewed rung: review when head unreviewed, stuck past the round cap', () => {
  // green (no checks) + draft + no review marker -> review
  assert.equal(selectRung(pr({ headSha: 'abc1234' })).action, 'review')
  // two prior rounds, head still unreviewed -> stuck (SHAs must be valid hex)
  const body = '<!-- neutral-review: abc0001 -->\n<!-- neutral-review: abc0002 -->'
  assert.equal(selectRung(pr({ headSha: 'beef999', body })).action, 'stuck')
  // a custom round cap is honoured
  assert.equal(selectRung(pr({ headSha: 'beef999', body: '<!-- neutral-review: abc0001 -->' }), 1).action, 'stuck')
})

test('selectRung terminal: ready-hold a reviewed draft, held once already ready — never merge', () => {
  const body = '<!-- neutral-review: abc1234 -->'
  assert.equal(selectRung(pr({ headSha: 'abc1234', body, isDraft: true })).action, 'ready-hold')
  assert.equal(selectRung(pr({ headSha: 'abc1234', body, isDraft: false })).action, 'held')
})

/** @param {import('../src/types.d.ts').RungDecision} d */
function pick(d) { return { rung: d.rung, action: d.action } }
