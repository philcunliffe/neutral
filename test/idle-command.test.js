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
 * @param {{prs?: any[], views?: Record<number, any>, issues?: any[]}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeWorld({ prs = [], views = {}, issues = [] } = {}) {
  return async (cmd, args) => {
    if (cmd === 'git') return ''                       // for-each-ref etc. — no fix branches
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      const fields = args[args.indexOf('--json') + 1]
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
