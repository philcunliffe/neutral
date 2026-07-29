// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectInitiative, leastRecentlyRun, AUTOPHAGY_PREFIX } from '../src/autophagy.js'
import { DEFAULT_CONFIG } from '../src/config.js'

// @ref LLP 0047#selection [tests] — cooldown-gated, least-recently-run idle selection
// @ref LLP 0036#eligibility [tests] — the per-member config + one-at-a-time gate

const NOW = Date.parse('2026-07-28T00:00:00Z')
const HOUR = 3600_000
/** @param {number} hoursAgo */
const ago = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString()
/** @param {Partial<Parameters<typeof selectInitiative>[0]>} over */
const sel = (over) => selectInitiative({ openPRs: [], disposed: [], config: DEFAULT_CONFIG, now: NOW, ...over })

test('selectInitiative: never-run member on an idle tick is selected', () => {
  const s = sel({})
  assert.equal(s.initiative, 'cleanup')
  assert.equal(s.members[0].eligible, true)
  assert.equal(s.members[0].lastDisposition, null)
})

test('selectInitiative: an open autophagy PR blocks the whole family — one at a time, even held', () => {
  const s = sel({ openPRs: [{ number: 7, head: `${AUTOPHAGY_PREFIX}cleanup-2026-07-27` }] })
  assert.equal(s.initiative, null)
  assert.equal(s.members[0].eligible, false)
  assert.match(s.members[0].reason, /pr#7/)
  assert.match(s.members[0].reason, /one autophagy PR at a time/)
})

test('selectInitiative: the per-repo switch turns the member off', () => {
  const config = { ...DEFAULT_CONFIG, autophagy: { ...DEFAULT_CONFIG.autophagy, codeCleanup: false } }
  const s = sel({ config })
  assert.equal(s.initiative, null)
  assert.equal(s.members[0].eligible, false)
  assert.match(s.members[0].reason, /codeCleanup/)
})

test('selectInitiative: a freshly-merged cleanup PR holds the member in merge cooldown', () => {
  // merged 1h ago, default merge cooldown 24h
  const s = sel({ disposed: [{ headRefName: `${AUTOPHAGY_PREFIX}cleanup-2026-07-27`, mergedAt: ago(1), closedAt: ago(1) }] })
  assert.equal(s.initiative, null)
  assert.equal(s.members[0].eligible, false)
  assert.match(s.members[0].reason, /merge cooldown/)
  assert.ok(s.members[0].cooldownRemaining > 0)
})

test('selectInitiative: past the merge cooldown, the member is eligible again', () => {
  const s = sel({ disposed: [{ headRefName: `${AUTOPHAGY_PREFIX}cleanup-2026-07-25`, mergedAt: ago(25), closedAt: ago(25) }] })
  assert.equal(s.initiative, 'cleanup')
  assert.equal(s.members[0].eligible, true)
})

test('selectInitiative: a rejection backs off longer than a merge (reject cooldown 168h)', () => {
  // closed-unmerged 25h ago: past the 24h merge cooldown, still inside the 168h reject one
  const s = sel({ disposed: [{ headRefName: `${AUTOPHAGY_PREFIX}cleanup-2026-07-25`, mergedAt: null, closedAt: ago(25) }] })
  assert.equal(s.initiative, null)
  assert.equal(s.members[0].eligible, false)
  assert.match(s.members[0].reason, /reject cooldown/)
})

test('selectInitiative: the most-recent disposition wins, older ones ignored', () => {
  const s = sel({ disposed: [
    { headRefName: `${AUTOPHAGY_PREFIX}cleanup-2026-07-01`, mergedAt: ago(600), closedAt: ago(600) }, // ancient, ignored
    { headRefName: `${AUTOPHAGY_PREFIX}cleanup-2026-07-27`, mergedAt: ago(2), closedAt: ago(2) }        // recent, governs
  ] })
  assert.equal(s.initiative, null) // held by the recent merge cooldown
})

test('selectInitiative: a no-op-damped member is ineligible even past cooldown', () => {
  const s = sel({ damped: ['cleanup'] })
  assert.equal(s.initiative, null)
  assert.equal(s.members[0].eligible, false)
  assert.match(s.members[0].reason, /no-op damped/)
})

test('selectInitiative: cooldownAfterMergeHours=0 disables the merge arm', () => {
  const config = { ...DEFAULT_CONFIG, autophagy: { ...DEFAULT_CONFIG.autophagy, cooldownAfterMergeHours: 0 } }
  const s = sel({ config, disposed: [{ headRefName: `${AUTOPHAGY_PREFIX}cleanup-2026-07-27`, mergedAt: ago(1), closedAt: ago(1) }] })
  assert.equal(s.initiative, 'cleanup')
  assert.equal(s.members[0].eligible, true)
})

// The rotation, tested directly so it is covered independent of the roster size (one
// real member today). LRR: oldest last disposition wins; never-run sorts oldest; ties
// fall to input order. @ref LLP 0047#rotation [tests]
test('leastRecentlyRun: oldest eligible member wins', () => {
  const id = leastRecentlyRun([
    { id: 'a', eligible: true, cooldownRemaining: 0, lastDisposition: NOW - 5 * HOUR, reason: '' },
    { id: 'b', eligible: true, cooldownRemaining: 0, lastDisposition: NOW - 50 * HOUR, reason: '' }
  ])
  assert.equal(id, 'b')
})

test('leastRecentlyRun: a never-run member outranks any that has run', () => {
  const id = leastRecentlyRun([
    { id: 'a', eligible: true, cooldownRemaining: 0, lastDisposition: NOW - 50 * HOUR, reason: '' },
    { id: 'b', eligible: true, cooldownRemaining: 0, lastDisposition: null, reason: '' }
  ])
  assert.equal(id, 'b')
})

test('leastRecentlyRun: ineligible members are skipped; ties keep input order', () => {
  assert.equal(leastRecentlyRun([
    { id: 'a', eligible: false, cooldownRemaining: 1, lastDisposition: null, reason: '' },
    { id: 'b', eligible: true, cooldownRemaining: 0, lastDisposition: NOW, reason: '' },
    { id: 'c', eligible: true, cooldownRemaining: 0, lastDisposition: NOW, reason: '' }
  ]), 'b')
  assert.equal(leastRecentlyRun([]), null)
})
