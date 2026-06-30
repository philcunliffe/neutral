// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idleState } from '../src/idle.js'

test('idle: empty backlog, every PR held, no needs-fix issue', () => {
  const s = idleState({
    backlog: [],
    prs: [{ number: 1, action: 'held' }, { number: 2, action: 'held' }],
    issues: [{ number: 9, state: 'attempt-exists' }, { number: 10, state: 'stuck' }]
  })
  assert.equal(s.idle, true)
  assert.deepEqual(s.blockers, [])
})

test('a default-empty call is idle', () => {
  assert.equal(idleState().idle, true)
  assert.equal(idleState({}).idle, true)
})

test('a non-empty backlog blocks idle (pipeline family)', () => {
  const s = idleState({ backlog: [{ number: 42, title: 'do a thing' }] })
  assert.equal(s.idle, false)
  assert.deepEqual(s.blockers, [{ family: 'pipeline', target: 'llp#42', reason: 'uncovered request — needs a design' }])
})

test('an implementable (Accepted, merged-to-target) design blocks idle (pipeline family)', () => {
  const s = idleState({ implementable: [{ number: 45, slug: 'client-attach' }] })
  assert.equal(s.idle, false)
  assert.deepEqual(s.blockers, [{ family: 'pipeline', target: 'llp#45', reason: 'accepted design merged to target — needs implementation' }])
})

test('wait is NOT idle — an in-flight PR keeps the tick open (LLP 0013)', () => {
  const s = idleState({ prs: [{ number: 7, action: 'wait' }] })
  assert.equal(s.idle, false)
  assert.deepEqual(s.blockers, [{ family: 'maintenance', target: 'pr#7', reason: 'action=wait' }])
})

test('every non-held PR action blocks idle; only held is at rest', () => {
  for (const action of ['wait', 'merge-base', 'resolve-conflict', 'fix-ci', 'review', 'stuck', 'ready-hold']) {
    assert.equal(idleState({ prs: [{ number: 1, action }] }).idle, false, `${action} should block idle`)
  }
  assert.equal(idleState({ prs: [{ number: 1, action: 'held' }] }).idle, true)
})

test('a needs-fix issue blocks idle; attempt-exists / stuck do not', () => {
  assert.equal(idleState({ issues: [{ number: 3, state: 'needs-fix' }] }).idle, false)
  assert.equal(idleState({ issues: [{ number: 3, state: 'attempt-exists' }] }).idle, true)
  assert.equal(idleState({ issues: [{ number: 3, state: 'stuck' }] }).idle, true)
})

test('blockers accumulate across both families', () => {
  const s = idleState({
    backlog: [{ number: 1, title: 'x' }],
    prs: [{ number: 5, action: 'fix-ci' }, { number: 6, action: 'held' }],
    issues: [{ number: 9, state: 'needs-fix' }]
  })
  assert.equal(s.idle, false)
  assert.deepEqual(s.blockers.map(b => b.target), ['llp#1', 'pr#5', 'issue#9'])
})
