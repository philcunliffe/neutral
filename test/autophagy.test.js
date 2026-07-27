// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanupState, AUTOPHAGY_PREFIX } from '../src/autophagy.js'
import { DEFAULT_CONFIG } from '../src/config.js'

// @ref LLP 0036#eligibility [tests] — the cleanup gate over the prs observation

test('cleanupState: eligible when the member is on and no autophagy PR is open', () => {
  const s = cleanupState([{ number: 1, head: 'integration/x' }, { number: 2, head: 'fix/issue-9' }], DEFAULT_CONFIG)
  assert.equal(s.eligible, true)
})

test('cleanupState: an open autophagy PR blocks — one at a time, even when held', () => {
  const s = cleanupState([{ number: 7, head: `${AUTOPHAGY_PREFIX}cleanup-2026-07-27` }], DEFAULT_CONFIG)
  assert.equal(s.eligible, false)
  assert.match(s.reason, /pr#7/)
  assert.match(s.reason, /one autophagy PR at a time/)
})

test('cleanupState: the per-repo switch turns the member off', () => {
  const config = { ...DEFAULT_CONFIG, autophagy: { codeCleanup: false } }
  const s = cleanupState([], config)
  assert.equal(s.eligible, false)
  assert.match(s.reason, /codeCleanup/)
})

test('cleanupState: no PRs at all is eligible', () => {
  assert.equal(cleanupState([], DEFAULT_CONFIG).eligible, true)
})
