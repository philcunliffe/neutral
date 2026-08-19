// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectIdle } from '../src/commands/idle.js'

/**
 * A fake runner answering git (fix-branch lookup) + gh (pr/issue), so the idle trigger
 * is exercised fully offline. The backlog comes from the (empty) temp repo's llp dir.
 * @param {{prs?: any[], views?: Record<number, any>, issues?: any[], disposed?: any[]}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeWorld({ prs = [], views = {}, issues = [], disposed = [] } = {}) {
  return async (cmd, args) => {
    if (cmd === 'git') return ''                       // for-each-ref etc. — no fix branches
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      const fields = args[args.indexOf('--json') + 1]
      // The closed-autophagy disposition query (LLP 0047) asks for mergedAt/closedAt.
      if (fields.includes('closedAt')) return JSON.stringify(disposed)
      return JSON.stringify(prs.map(p => fields.includes('body')
        ? { number: p.number, body: p.body || '', headRefName: p.headRefName }
        : { number: p.number, headRefName: p.headRefName }))
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return JSON.stringify(views[Number(args[2])])
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues)
    throw new Error('unexpected ' + cmd + ' ' + args.join(' '))
  }
}

/**
 * A held (terminal) PR view — mergeable ∧ green ∧ reviewed, no longer a draft.
 * @param {number} number @param {string} head
 */
function heldView(number, head) {
  return {
    number, headRefName: head, baseRefName: 'main', isDraft: false,
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [],
    headRefOid: 'abc1234', body: '<!-- neutral-review: abc1234 -->'
  }
}

test('collectIdle: idle ∧ ctx > T ⇒ recycle', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const exec = fakeWorld({
      prs: [{ number: 1, headRefName: 'integration/x' }],
      views: { 1: heldView(1, 'integration/x') },
      issues: [{ number: 9, title: 'resolved', labels: [{ name: 'neutral:fix' }, { name: 'neutral:stuck' }] }]
    })
    const s = await collectIdle(repo, exec, () => 600_000) // default T = 500k
    assert.equal(s.idle, true)
    assert.equal(s.recycle, true)
    assert.equal(s.initiative, 'recycle') // runtime preempts repo hygiene (LLP 0035)
    assert.equal(s.contextSize, 600_000)
    assert.deepEqual(s.blockers, [])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: idle but ctx ≤ T ⇒ no recycle (slack, but context still small)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const exec = fakeWorld({ prs: [{ number: 1, headRefName: 'integration/x' }], views: { 1: heldView(1, 'integration/x') } })
    const s = await collectIdle(repo, exec, () => 100_000)
    assert.equal(s.idle, true)
    assert.equal(s.recycle, false)
    assert.equal(s.initiative, 'cleanup') // slack + no open autophagy PR (LLP 0036)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: unmeasurable context ⇒ never recycle (safe default)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const s = await collectIdle(repo, fakeWorld(), () => null)
    assert.equal(s.idle, true)
    assert.equal(s.contextSize, null)
    assert.equal(s.recycle, false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: an in-flight PR (action != held) blocks idle even with huge context', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const exec = fakeWorld({
      prs: [{ number: 1, headRefName: 'integration/x' }],
      // BEHIND ⇒ action merge-base ⇒ in flight
      views: { 1: { ...heldView(1, 'integration/x'), mergeStateStatus: 'BEHIND' } }
    })
    const s = await collectIdle(repo, exec, () => 900_000)
    assert.equal(s.idle, false)
    assert.equal(s.recycle, false)
    assert.equal(s.initiative, null) // not idle ⇒ no initiative at all (LLP 0035)
    assert.deepEqual(s.blockers, [{ family: 'maintenance', target: 'pr#1', reason: 'action=merge-base' }])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: a needs-fix issue blocks idle', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const exec = fakeWorld({ issues: [{ number: 9, title: 'fresh', labels: [{ name: 'neutral:fix' }] }] })
    const s = await collectIdle(repo, exec, () => 900_000)
    assert.equal(s.idle, false)
    assert.equal(s.recycle, false)
    assert.deepEqual(s.blockers, [{ family: 'maintenance', target: 'issue#9', reason: 'needs-fix — no fix attempt yet' }])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: a held autophagy PR keeps the tick idle but blocks the next cleanup (LLP 0036)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const exec = fakeWorld({
      prs: [{ number: 5, headRefName: 'autophagy/cleanup-2026-07-27' }],
      views: { 5: heldView(5, 'autophagy/cleanup-2026-07-27') }
    })
    const s = await collectIdle(repo, exec, () => 100_000)
    assert.equal(s.idle, true)            // held is at rest — the human must dispose
    assert.equal(s.members[0].eligible, false) // …but one autophagy PR at a time
    assert.equal(s.initiative, null)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: admission capacity blocks a new cleanup initiative (LLP 0060)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    mkdirSync(join(repo, '.neutral'))
    writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ maxActiveWork: 1 }))
    const exec = fakeWorld({
      prs: [{ number: 1, headRefName: 'integration/x' }],
      views: { 1: heldView(1, 'integration/x') }
    })
    const s = await collectIdle(repo, exec, () => 100_000)
    assert.equal(s.idle, true)
    assert.equal(s.admission.open, false)
    assert.equal(s.initiative, null)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: an in-flight autophagy PR blocks idle like any own PR', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const exec = fakeWorld({
      prs: [{ number: 5, headRefName: 'autophagy/cleanup-2026-07-27' }],
      views: { 5: { ...heldView(5, 'autophagy/cleanup-2026-07-27'), mergeStateStatus: 'BEHIND' } }
    })
    const s = await collectIdle(repo, exec, () => 100_000)
    assert.equal(s.idle, false)
    assert.equal(s.initiative, null)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: autophagy.codeCleanup=false leaves an idle tick with no initiative', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    mkdirSync(join(repo, '.neutral'))
    writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ autophagy: { codeCleanup: false } }))
    const s = await collectIdle(repo, fakeWorld(), () => 100_000)
    assert.equal(s.idle, true)
    assert.equal(s.members[0].eligible, false)
    assert.equal(s.initiative, null)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: a recently-merged cleanup PR holds the tick idle with no initiative (cooldown, LLP 0047)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const now = Date.parse('2026-07-28T00:00:00Z')
    const mergedAt = new Date(now - 2 * 3600_000).toISOString() // 2h ago, inside the 24h merge cooldown
    const exec = fakeWorld({ disposed: [{ number: 8, headRefName: 'autophagy/cleanup-2026-07-27', mergedAt, closedAt: mergedAt }] })
    const s = await collectIdle(repo, exec, () => 100_000, { now })
    assert.equal(s.idle, true)                 // nothing in flight — genuinely at rest
    assert.equal(s.initiative, null)           // …but the member is cooling down
    assert.equal(s.members[0].eligible, false)
    assert.match(s.members[0].reason, /merge cooldown/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle: a no-op-damped member yields a deliberately idle tick (LLP 0047)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    const s = await collectIdle(repo, fakeWorld(), () => 100_000, { damped: ['cleanup'] })
    assert.equal(s.idle, true)
    assert.equal(s.initiative, null)
    assert.match(s.members[0].reason, /no-op damped/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('collectIdle honours a per-repo contextRecycleThreshold override', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-idle-'))
  try {
    mkdirSync(join(repo, '.neutral'))
    writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ contextRecycleThreshold: 50_000 }))
    const s = await collectIdle(repo, fakeWorld(), () => 60_000)
    assert.equal(s.threshold, 50_000)
    assert.equal(s.recycle, true)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
