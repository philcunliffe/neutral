// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAncestor, doneSetFromGit, branchExists, resolveRef, changeSetMergedToTarget } from '../src/git.js'

/**
 * A fake `git` runner. `ancestors[a]` lists refs that `a` is an ancestor of;
 * `exist` lists refs that resolve; `trailers[ref]` is its `git log --grep` output.
 * Mirrors real exit codes: merge-base/rev-parse exit 1 on the negative case.
 * @param {{ancestors?: Record<string,string[]>, exist?: string[], tree?: Record<string,string[]>}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeGit({ ancestors = {}, exist = [], tree = {} }) {
  return async (_cmd, args) => {
    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      const ref = args[args.length - 1].replace('^{commit}', '')
      if (exist.includes(ref)) return 'deadbeef\n'
      const e = new Error('missing'); /** @type {any} */ (e).code = 1; throw e
    }
    if (args[0] === 'merge-base') {
      const a = args[2], b = args[3]
      if ((ancestors[a] || []).includes(b)) return ''
      const e = new Error('not ancestor'); /** @type {any} */ (e).code = 1; throw e
    }
    if (args[0] === 'ls-tree') {
      return (tree[args[3]] || []).join('\n') + '\n'
    }
    throw new Error('unexpected git ' + args.join(' '))
  }
}

test('isAncestor maps exit 0/1 to true/false', async () => {
  const exec = fakeGit({ ancestors: { b1: ['integration'] } })
  assert.equal(await isAncestor('/r', 'b1', 'integration', exec), true)
  assert.equal(await isAncestor('/r', 'b2', 'integration', exec), false)
})

test('branchExists reflects whether the ref resolves', async () => {
  const exec = fakeGit({ exist: ['integration'] })
  assert.equal(await branchExists('/r', 'integration', exec), true)
  assert.equal(await branchExists('/r', 'nope', exec), false)
})

test('resolveRef prefers origin/<name>, falls back to local, else null', async () => {
  assert.equal(await resolveRef('/r', 'integration/x', fakeGit({ exist: ['origin/integration/x', 'integration/x'] })), 'origin/integration/x')
  assert.equal(await resolveRef('/r', 'integration/x', fakeGit({ exist: ['integration/x'] })), 'integration/x')
  assert.equal(await resolveRef('/r', 'integration/x', fakeGit({ exist: [] })), null)
})

test('doneSetFromGit derives done from verified ancestry, not a status field', async () => {
  /** @type {import('../src/types.d.ts').Task[]} */
  const tasks = [
    { id: 'T1', branch: 'b1', deps: [] },
    { id: 'T2', branch: 'b2', deps: ['T1'] },
    { id: 'T3', branch: 'b3', deps: ['T1'] }
  ]
  // integration exists; only b1 and b3 exist and are ancestors. b2 not created yet.
  const exec = fakeGit({ exist: ['integration', 'b1', 'b3'], ancestors: { b1: ['integration'], b3: ['integration'] } })
  const done = await doneSetFromGit('/r', 'integration', tasks, exec)
  assert.deepEqual([...done].sort(), ['T1', 'T3'])
})

test('doneSetFromGit returns empty when the integration branch does not exist yet', async () => {
  /** @type {import('../src/types.d.ts').Task[]} */
  const tasks = [{ id: 'T1', branch: 'b1', deps: [] }]
  const exec = fakeGit({ exist: ['b1'] }) // no integration ref
  assert.deepEqual([...await doneSetFromGit('/r', 'integration', tasks, exec)], [])
})

test('changeSetMergedToTarget is true only when the design LLP is on target', async () => {
  const merged = fakeGit({ exist: ['origin/main'], tree: { 'origin/main': ['llp/0004-auth.spec.md', 'llp/0005-auth.design.md'] } })
  assert.equal(await changeSetMergedToTarget('/r', 'auth', 'origin/main', merged), true)

  // design not yet on target (still only on the integration branch)
  const pending = fakeGit({ exist: ['origin/main'], tree: { 'origin/main': ['llp/0004-auth.spec.md'] } })
  assert.equal(await changeSetMergedToTarget('/r', 'auth', 'origin/main', pending), false)
})

test('a non-1 git error propagates (we do not silently treat it as "not merged")', async () => {
  /** @type {import('../src/git.js').run} */
  const exec = async () => {
    const err = new Error('fatal: bad object'); /** @type {any} */ (err).code = 128; throw err
  }
  await assert.rejects(() => isAncestor('/r', 'x', 'y', exec), /bad object/)
})
