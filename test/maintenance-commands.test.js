// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectPRs } from '../src/commands/prs.js'
import { collectIssues } from '../src/commands/issues.js'

/**
 * A fake runner that answers both `git` (for-each-ref) and `gh` (pr/issue), so the
 * maintenance observe surface can be exercised fully offline.
 * @param {{prs?: any[], views?: Record<number, any>, issues?: any[], fixBranches?: string[]}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeWorld({ prs = [], views = {}, issues = [], fixBranches = [] } = {}) {
  return async (cmd, args) => {
    if (cmd === 'git' && args[0] === 'for-each-ref') {
      // only the `fix/*` lookup is exercised here
      return fixBranches.join('\n') + '\n'
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      const fields = args[args.indexOf('--json') + 1]
      return JSON.stringify(prs.map(p => fields.includes('body')
        ? { number: p.number, body: p.body || '', headRefName: p.headRefName }
        : { number: p.number, headRefName: p.headRefName }))
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify(views[Number(args[2])])
    }
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify(issues)
    }
    throw new Error('unexpected ' + cmd + ' ' + args.join(' '))
  }
}

test('collectPRs keeps only neutral-owned heads and attaches a rung decision', async () => {
  const exec = fakeWorld({
    prs: [
      { number: 1, headRefName: 'integration/auth' },  // own
      { number: 2, headRefName: 'fix/issue-9' },        // own
      { number: 3, headRefName: 'feature/from-a-human' } // foreign — out of scope (deferred)
    ],
    views: {
      1: { number: 1, headRefName: 'integration/auth', baseRefName: 'main', isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND', statusCheckRollup: [], headRefOid: 'aaa' },
      2: { number: 2, headRefName: 'fix/issue-9', baseRefName: 'main', isDraft: true, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', statusCheckRollup: [], headRefOid: 'bbb' }
    }
  })
  const got = await collectPRs('/r', exec)
  assert.deepEqual(got.map(p => [p.number, p.rung, p.action]), [
    [1, 'mergeable', 'merge-base'],
    [2, 'mergeable', 'resolve-conflict']
  ])
})

test('collectPRs is empty when there are no open PRs (offline-safe)', async () => {
  assert.deepEqual(await collectPRs('/r', fakeWorld({ prs: [] })), [])
})

test('collectIssues classifies each neutral:fix issue from ground truth', async () => {
  const exec = fakeWorld({
    issues: [
      { number: 9, title: 'has a branch', labels: [{ name: 'neutral:fix' }] },
      { number: 10, title: 'has a fixes PR', labels: [{ name: 'neutral:fix' }] },
      { number: 11, title: 'stuck', labels: [{ name: 'neutral:fix' }, { name: 'neutral:stuck' }] },
      { number: 12, title: 'fresh', labels: [{ name: 'neutral:fix' }] }
    ],
    fixBranches: ['fix/issue-9'],
    prs: [{ number: 30, headRefName: 'fix/issue-10', body: 'Fixes #10' }]
  })
  const got = await collectIssues('/r', exec)
  assert.deepEqual(got.map(i => [i.number, i.state]), [
    [9, 'attempt-exists'],
    [10, 'attempt-exists'],
    [11, 'stuck'],
    [12, 'needs-fix']
  ])
})

test('collectIssues is empty when no issues carry the label', async () => {
  assert.deepEqual(await collectIssues('/r', fakeWorld({ issues: [] })), [])
})
