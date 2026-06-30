// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAncestor, doneSetFromGit, branchExists, resolveRef, changeSetMergedToTarget, readLlpsFromRef, readCodeRefsFromRef } from '../src/git.js'
import { observe } from '../src/state.js'

/**
 * A fake `git`/`gh` runner. `ancestors[a]` lists refs that `a` is an ancestor of;
 * `exist` lists refs that resolve; `tree[ref]` is its `ls-tree` listing; `content[ref:path]`
 * is its `git show` body (absent => exit 128, which showFile maps to null); `grep[ref]`
 * is its `git grep` output (absent => exit 1, mirroring git grep's no-match exit);
 * `defaultBranch` is what `gh repo view` reports.
 * Mirrors real exit codes: merge-base/rev-parse exit 1 on the negative case.
 * @param {{ancestors?: Record<string,string[]>, exist?: string[], tree?: Record<string,string[]>, content?: Record<string,string>, grep?: Record<string,string>, defaultBranch?: string}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeGit({ ancestors = {}, exist = [], tree = {}, content = {}, grep = {}, defaultBranch }) {
  return async (cmd, args) => {
    if (cmd === 'gh') {
      if (defaultBranch !== undefined) return defaultBranch + '\n'
      const e = new Error('no gh'); /** @type {any} */ (e).code = 1; throw e
    }
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
    if (args[0] === 'show') {
      if (args[1] in content) return content[args[1]]
      const e = new Error('path missing'); /** @type {any} */ (e).code = 128; throw e
    }
    if (args[0] === 'grep') {
      const ref = args[args.indexOf('--') - 1]
      if (ref in grep) return grep[ref]
      const e = new Error('no match'); /** @type {any} */ (e).code = 1; throw e
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

test('changeSetMergedToTarget: true only when the design LLP is on target AND Status: Active', async () => {
  const active = fakeGit({
    exist: ['origin/main'],
    tree: { 'origin/main': ['llp/0004-auth.spec.md', 'llp/0005-auth.design.md'] },
    content: { 'origin/main:llp/0005-auth.design.md': '# LLP 5: Auth\n\n**Type:** design\n**Status:** Active\n' }
  })
  assert.equal(await changeSetMergedToTarget('/r', 'auth', 'origin/main', active), true)

  // design IS on target but still Accepted (a design-first doc merge, code not built) -> NOT shipped
  const accepted = fakeGit({
    exist: ['origin/main'],
    tree: { 'origin/main': ['llp/0005-auth.design.md'] },
    content: { 'origin/main:llp/0005-auth.design.md': '# LLP 5: Auth\n\n**Type:** design\n**Status:** Accepted\n' }
  })
  assert.equal(await changeSetMergedToTarget('/r', 'auth', 'origin/main', accepted), false)

  // design not yet on target at all (still only on the integration branch)
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

test('readLlpsFromRef parses the corpus AT A REF, sorted, with tombstone + role intact', async () => {
  const exec = fakeGit({
    tree: { 'origin/main': ['llp/0002-bar.design.md', 'llp/0001-foo.spec.md', 'llp/README.txt', 'llp/tombstones/0000-old.plan.md'] },
    content: {
      'origin/main:llp/0001-foo.spec.md': '# LLP 1: Foo\n\n**Type:** spec\n**Status:** Accepted\n',
      'origin/main:llp/0002-bar.design.md': '# LLP 2: Bar\n\n**Type:** design\n**Status:** Active\n\n@ref LLP 0001\n',
      'origin/main:llp/tombstones/0000-old.plan.md': '# LLP 0: Old\n\n**Type:** plan\n**Status:** Active\n'
    }
  })
  const llps = await readLlpsFromRef('/r', 'origin/main', undefined, exec)
  assert.deepEqual(llps.map(l => l.number), [0, 1, 2]) // sorted; README.txt skipped
  assert.equal(llps[2].refs.includes(1), true)         // design 2 @refs request 1
  assert.equal(llps[0].status, 'Tombstoned')           // tombstones/ path => tombstoned
  assert.equal(llps[2].path, 'llp/0002-bar.design.md') // path is the ref-relative path
})

test('readLlpsFromRef degrades to [] when the ref is missing', async () => {
  const exec = fakeGit({}) // ls-tree on an absent ref throws in real git
  const bad = /** @type {import('../src/git.js').run} */ (async (_c, a) => {
    if (a[0] === 'ls-tree') { const e = new Error('bad ref'); /** @type {any} */ (e).code = 128; throw e }
    return ''
  })
  assert.deepEqual(await readLlpsFromRef('/r', 'origin/nope', undefined, bad), [])
  assert.deepEqual(await readLlpsFromRef('/r', 'origin/empty', undefined, exec), []) // empty tree
})

test('readCodeRefsFromRef extracts @ref numbers via git grep; no match => empty', async () => {
  const exec = fakeGit({ grep: { 'origin/main': '// @ref LLP 0007 gloss\n * @ref LLP 0003 [implements]\n@ref LLP 7 dup\n' } })
  const refs = await readCodeRefsFromRef('/r', 'origin/main', undefined, exec)
  assert.deepEqual([...refs].sort((a, b) => a - b), [3, 7]) // deduped, zero-padded + bare both parse
  const empty = await readCodeRefsFromRef('/r', 'origin/clean', undefined, exec) // no grep entry => exit 1
  assert.equal(empty.size, 0)
})

test('observe reads from origin/<default> (the fetched ref), not the working tree', async () => {
  // The whole bug: a request merged to master after the local checkout was last pulled
  // must be observed. Drive observe entirely through the fake — no real repo touched.
  const exec = fakeGit({
    defaultBranch: 'master',
    exist: ['origin/master'],
    tree: { 'origin/master': ['llp/0049-policy.spec.md'] },
    content: { 'origin/master:llp/0049-policy.spec.md': '# LLP 49: Policy\n\n**Type:** spec\n**Status:** Accepted\n' },
    grep: { 'origin/master': '' } // no code @refs
  })
  const world = await observe('/r', exec)
  assert.deepEqual(world.llps.map(l => l.number), [49])
  // 0049 is a live request @ref'd by no design and no code -> it is uncovered backlog
  assert.deepEqual(world.coverage.uncovered.map(l => l.number), [49])
})
