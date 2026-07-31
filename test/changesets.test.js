// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changeSetAction, collectChangeSets } from '../src/changesets.js'
import { idleState } from '../src/idle.js'

/** @param {string} id @param {string[]} [deps] */
const task = (id, deps = []) => ({ id, branch: `task/x/${id}`, deps })

// ---------------------------------------------------------------------------
// changeSetAction — the pure per-change-set classifier (LLP 0052)
// ---------------------------------------------------------------------------

test('changeSetAction: no plan ⇒ plan gap', () => {
  const r = changeSetAction({ shipped: false, plan: null, tasks: null, hasOpenPR: false })
  assert.equal(r.action, 'plan')
})

test('changeSetAction: empty task list ⇒ plan gap', () => {
  const r = changeSetAction({ shipped: false, plan: 'llp/0001-x.plan.md', tasks: { ready: [], blocked: [], done: [] }, hasOpenPR: false })
  assert.equal(r.action, 'plan')
})

test('changeSetAction: unblocked tasks ⇒ implement, naming the ready ids', () => {
  const r = changeSetAction({
    shipped: false, plan: 'llp/0001-x.plan.md', hasOpenPR: false,
    tasks: { ready: [task('T2'), task('T3')], blocked: [task('T4', ['T2'])], done: [task('T1')] }
  })
  assert.equal(r.action, 'implement')
  assert.match(r.reason, /T2,T3/)
})

test('changeSetAction: all merged with no PR ⇒ create-pr; with an open PR ⇒ nothing owed', () => {
  const tasks = { ready: [], blocked: [], done: [task('T1'), task('T2')] }
  assert.equal(changeSetAction({ shipped: false, plan: 'p', tasks, hasOpenPR: false }).action, 'create-pr')
  assert.equal(changeSetAction({ shipped: false, plan: 'p', tasks, hasOpenPR: true }).action, null)
})

test('changeSetAction: shipped ⇒ nothing owed, even with a stale-looking queue', () => {
  const r = changeSetAction({ shipped: true, plan: null, tasks: null, hasOpenPR: false })
  assert.equal(r.action, null)
})

// ---------------------------------------------------------------------------
// idleState — a change-set gap blocks idle (LLP 0052#idle-extension)
// ---------------------------------------------------------------------------

test('idleState: a change set owed an action blocks idle; one owed nothing does not', () => {
  const busy = idleState({ changesets: [{ slug: 'x', action: 'implement', reason: '2 task(s) unblocked: T1,T2' }] })
  assert.equal(busy.idle, false)
  assert.deepEqual(busy.blockers.map(b => b.target), ['changeset/x'])
  assert.match(busy.blockers[0].reason, /action=implement/)

  const rest = idleState({ changesets: [{ slug: 'x', action: null, reason: 'blocked on in-flight work' }] })
  assert.equal(rest.idle, true)
})

// ---------------------------------------------------------------------------
// collectChangeSets — the ref-based sweep, fully offline via a fake git
// ---------------------------------------------------------------------------

const PLAN = [
  '# LLP 0009: x, implementation plan', '',
  '**Type:** Plan', '**Status:** Active', '',
  '## Tasks', '',
  '- id: T1  branch: task/x/T1  deps: []',
  '- id: T2  branch: task/x/T2  deps: [T1]', ''
].join('\n')

/**
 * A fake `git`/`gh` runner for the sweep: `branches` answers for-each-ref, `exist`
 * rev-parse, `tree`/`content` ls-tree + show at a ref, `ancestors`/`firstParent`/
 * `merges` the done-set derivation (see test/git.test.js for the field semantics).
 * `gh repo view` (defaultBranch) fails unless given — the sweep must degrade.
 * @param {{branches?: string[], exist?: string[], shas?: Record<string,string>, ancestors?: Record<string,string[]>, firstParent?: Record<string,string[]>, merges?: Record<string,[string,string,string][]>, tree?: Record<string,string[]>, content?: Record<string,string>, defaultBranch?: string}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeGit({ branches = [], exist = [], shas = {}, ancestors = {}, firstParent = {}, merges = {}, tree = {}, content = {}, defaultBranch } = {}) {
  return async (cmd, args) => {
    if (cmd === 'gh') {
      if (defaultBranch !== undefined) return defaultBranch + '\n'
      const e = new Error('no gh'); /** @type {any} */ (e).code = 1; throw e
    }
    if (args[0] === 'for-each-ref') return branches.join('\n') + '\n'
    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      const ref = args[args.length - 1].replace('^{commit}', '')
      if (exist.includes(ref)) return (shas[ref] || 'deadbeef') + '\n'
      const e = new Error('missing'); /** @type {any} */ (e).code = 1; throw e
    }
    if (args[0] === 'merge-base') {
      if ((ancestors[args[2]] || []).includes(args[3])) return ''
      const e = new Error('not ancestor'); /** @type {any} */ (e).code = 1; throw e
    }
    if (args[0] === 'rev-list' && args[1] === '--first-parent') return (firstParent[args[2]] || []).join('\n') + '\n'
    if (args[0] === 'log' && args[1] === '--first-parent') {
      return (merges[args[args.length - 1]] || []).map(r => r.join('\x1f') + '\x1e\n').join('')
    }
    if (args[0] === 'ls-tree') return (tree[args[3]] || []).join('\n') + '\n'
    if (args[0] === 'show') {
      if (args[1] in content) return content[args[1]]
      const e = new Error('path missing'); /** @type {any} */ (e).code = 128; throw e
    }
    if (args[0] === 'symbolic-ref') { const e = new Error('no origin HEAD'); /** @type {any} */ (e).code = 1; throw e }
    throw new Error('unexpected ' + cmd + ' ' + args.join(' '))
  }
}

/** @param {(repo: string) => Promise<void>} fn */
async function inTempRepo(fn) {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cs-'))
  try { await fn(repo) } finally { rmSync(repo, { recursive: true, force: true }) }
}

test('collectChangeSets: plan on the REF (not the working tree) yields the queues', async () => {
  await inTempRepo(async repo => {
    const exec = fakeGit({
      branches: ['origin/integration/x'],
      exist: ['origin/integration/x', 'origin/task/x/T1'],
      shas: { 'origin/task/x/T1': 't1tip' },
      ancestors: { 'origin/task/x/T1': ['origin/integration/x'] },
      firstParent: { 'origin/integration/x': ['m1', 'base'] },
      tree: { 'origin/integration/x': ['llp/0009-x.plan.md'] },
      content: { 'origin/integration/x:llp/0009-x.plan.md': PLAN }
    })
    const [c] = await collectChangeSets(repo, exec)
    assert.equal(c.slug, 'x')
    assert.equal(c.plan, 'llp/0009-x.plan.md')
    assert.equal(c.action, 'implement')            // T1 done ⇒ T2 unblocked
    assert.deepEqual(c.done.map(t => t.id), ['T1'])
    assert.deepEqual(c.ready.map(t => t.id), ['T2'])
  })
})

test('collectChangeSets: all tasks merged — create-pr without an open PR, nothing owed with one', async () => {
  await inTempRepo(async repo => {
    const cfg = {
      branches: ['origin/integration/x'],
      exist: ['origin/integration/x', 'origin/task/x/T1', 'origin/task/x/T2'],
      shas: { 'origin/task/x/T1': 't1tip', 'origin/task/x/T2': 't2tip' },
      ancestors: { 'origin/task/x/T1': ['origin/integration/x'], 'origin/task/x/T2': ['origin/integration/x'] },
      firstParent: { 'origin/integration/x': ['m2', 'm1', 'base'] },
      tree: { 'origin/integration/x': ['llp/0009-x.plan.md'] },
      content: { 'origin/integration/x:llp/0009-x.plan.md': PLAN }
    }
    const [bare] = await collectChangeSets(repo, fakeGit(cfg))
    assert.equal(bare.action, 'create-pr')
    const [carried] = await collectChangeSets(repo, fakeGit(cfg), { openHeads: new Set(['integration/x']) })
    assert.equal(carried.action, null)
  })
})

test('collectChangeSets: deleted task ref still reads done via the merge commit (LLP 0051)', async () => {
  await inTempRepo(async repo => {
    const exec = fakeGit({
      branches: ['origin/integration/x'],
      exist: ['origin/integration/x'],               // NO task refs — auto-deleted on merge
      firstParent: { 'origin/integration/x': ['m2', 'm1', 'base'] },
      merges: {
        'origin/integration/x': [
          ['m2', 'm1 t2tip', "Merge pull request #7 from o/task/x/T2"],
          ['m1', 'base t1tip', "Merge pull request #6 from o/task/x/T1"]
        ]
      },
      tree: { 'origin/integration/x': ['llp/0009-x.plan.md'] },
      content: { 'origin/integration/x:llp/0009-x.plan.md': PLAN }
    })
    const [c] = await collectChangeSets(repo, exec)
    assert.deepEqual(c.done.map(t => t.id).sort(), ['T1', 'T2'])
    assert.equal(c.action, 'create-pr')
  })
})

test('collectChangeSets: no plan on the branch ⇒ plan gap; malformed plan carries the parse error', async () => {
  await inTempRepo(async repo => {
    const noPlan = fakeGit({
      branches: ['origin/integration/x'],
      exist: ['origin/integration/x'],
      tree: { 'origin/integration/x': ['llp/0008-x.design.md'] },
      content: { 'origin/integration/x:llp/0008-x.design.md': '# LLP 0008: x design\n\n**Type:** Design\n' }
    })
    const [a] = await collectChangeSets(repo, noPlan)
    assert.equal(a.action, 'plan')

    const malformed = fakeGit({
      branches: ['origin/integration/x'],
      exist: ['origin/integration/x'],
      tree: { 'origin/integration/x': ['llp/0009-x.plan.md'] },
      content: { 'origin/integration/x:llp/0009-x.plan.md': '## Tasks\n\n- id: T1  deps: []\n' } // missing branch:
    })
    const [b] = await collectChangeSets(repo, malformed)
    assert.equal(b.action, 'plan')
    assert.match(b.reason, /malformed task line/)
  })
})

test('collectChangeSets: shipped change set (design Active on target) owes nothing', async () => {
  await inTempRepo(async repo => {
    const design = '# LLP 0008: x\n\n**Type:** Design\n**Status:** Active\n'
    const exec = fakeGit({
      defaultBranch: 'main',
      branches: ['origin/integration/x'],
      exist: ['origin/integration/x', 'origin/main'],
      tree: {
        'origin/main': ['llp/0008-x.design.md'],
        'origin/integration/x': ['llp/0008-x.design.md', 'llp/0009-x.plan.md']
      },
      content: {
        'origin/main:llp/0008-x.design.md': design,
        'origin/integration/x:llp/0008-x.design.md': design,
        'origin/integration/x:llp/0009-x.plan.md': PLAN
      }
    })
    const [c] = await collectChangeSets(repo, exec)
    assert.equal(c.shipped, true)
    assert.equal(c.action, null)
  })
})

test('collectChangeSets: no integration branches / git failure ⇒ empty, never a throw', async () => {
  await inTempRepo(async repo => {
    assert.deepEqual(await collectChangeSets(repo, fakeGit({})), [])
    const broken = async () => { throw new Error('git unavailable') }
    assert.deepEqual(await collectChangeSets(repo, /** @type {any} */ (broken)), [])
  })
})
