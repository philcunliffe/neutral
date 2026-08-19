// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { admissionState } from '../src/admission.js'

test('admission counts each active PR, change set and fix branch once (LLP 0060)', () => {
  const s = admissionState({
    prs: [
      { number: 1, head: 'integration/with-pr', action: 'review' },
      { number: 2, head: 'fix/issue-9', action: 'held' }
    ],
    changesets: [
      changeset('with-pr'),
      changeset('without-pr'),
      { ...changeset('shipped'), shipped: true }
    ],
    issues: [
      { number: 9, title: 'covered by PR', state: 'attempt-exists', via: 'branch:fix/issue-9' },
      { number: 10, title: 'branch only', state: 'attempt-exists', via: 'branch:fix/issue-10' },
      { number: 11, title: 'not admitted yet', state: 'needs-fix' }
    ]
  }, 5)

  assert.equal(s.used, 4)
  assert.equal(s.available, 1)
  assert.equal(s.open, true)
  assert.deepEqual(s.active.map(x => x.target), ['pr#1', 'pr#2', 'changeset/without-pr', 'issue#10'])
})

test('held stuck work is frozen outside the cap; replied work becomes active again', () => {
  const s = admissionState({
    prs: [
      { number: 1, head: 'integration/frozen', action: 'held', stuck: true },
      { number: 2, head: 'integration/replied', action: 'unstick', stuck: true }
    ],
    changesets: [changeset('frozen'), changeset('replied')],
    issues: [{ number: 7, title: 'human needed', state: 'stuck', via: 'label:neutral:stuck' }]
  }, 1)

  assert.equal(s.used, 1)
  assert.equal(s.open, false)
  assert.deepEqual(s.active.map(x => x.target), ['pr#2'])
  assert.deepEqual(s.frozen.map(x => x.target), ['pr#1', 'issue#7'])
})

test('zero is a valid hard intake stop', () => {
  const s = admissionState({}, 0)
  assert.equal(s.used, 0)
  assert.equal(s.available, 0)
  assert.equal(s.open, false)
})

/** @param {string} slug */
function changeset(slug) {
  return {
    slug,
    integration: `integration/${slug}`,
    plan: null,
    shipped: false,
    action: /** @type {'plan'} */ ('plan'),
    reason: 'needs a plan',
    ready: [], blocked: [], done: []
  }
}
