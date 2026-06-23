// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inFlightCoveredRefs } from '../src/inflight.js'

/**
 * Fake git for the in-flight scan: for-each-ref lists branches, rev-parse checks
 * existence, ls-tree lists a branch's llp/ files, show returns file bodies.
 * @param {{branches?: string[], exist?: string[], tree?: Record<string,string[]>, files?: Record<string,string>}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeGit({ branches = [], exist = [], tree = {}, files = {} }) {
  return async (_cmd, args) => {
    if (args[0] === 'for-each-ref') return branches.join('\n') + '\n'
    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      const ref = args[args.length - 1].replace('^{commit}', '')
      if (exist.includes(ref)) return 'sha\n'
      const e = new Error('missing'); /** @type {any} */ (e).code = 1; throw e
    }
    if (args[0] === 'ls-tree') return (tree[args[3]] || []).join('\n') + '\n'
    if (args[0] === 'show') return files[args[1]] || ''
    throw new Error('unexpected git ' + args.join(' '))
  }
}

test('inFlightCoveredRefs collects @refs from design/plan LLPs on integration branches', async () => {
  const exec = fakeGit({
    branches: ['integration/auth', 'origin/integration/auth', 'integration/sync'],
    exist: ['origin/integration/auth', 'integration/sync'],
    tree: {
      'origin/integration/auth': ['llp/0010-auth.design.md', 'llp/README.md'],
      'integration/sync': ['llp/0020-sync.design.md']
    },
    files: {
      'origin/integration/auth:llp/0010-auth.design.md': '@ref LLP 0042 — login\n@ref LLP 0043 — sessions',
      'integration/sync:llp/0020-sync.design.md': '@ref LLP 0044 — offline queue'
    }
  })
  const refs = await inFlightCoveredRefs('/r', exec)
  assert.deepEqual([...refs].sort((a, b) => a - b), [42, 43, 44])
})

test('inFlightCoveredRefs is empty when there are no integration branches', async () => {
  const refs = await inFlightCoveredRefs('/r', fakeGit({ branches: [] }))
  assert.equal(refs.size, 0)
})
