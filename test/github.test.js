// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listOpenPRs, viewPR, normalizePR, listLabelledIssues, listOpenPRBodies } from '../src/github.js'

/**
 * A fake `gh` runner keyed by subcommand. `fail` makes every call throw (offline).
 * @param {{prList?: any, prView?: any, issueList?: any, prBodies?: any, fail?: boolean}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeGh({ prList, prView, issueList, prBodies, fail = false } = {}) {
  return async (cmd, args) => {
    if (fail) { const e = new Error('gh: no remote'); /** @type {any} */ (e).code = 1; throw e }
    assert.equal(cmd, 'gh')
    if (args[0] === 'pr' && args[1] === 'list') {
      const fields = args[args.indexOf('--json') + 1]
      return JSON.stringify(fields.includes('body') ? prBodies : prList)
    }
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify(prView)
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issueList)
    throw new Error('unexpected gh ' + args.join(' '))
  }
}

test('listOpenPRs returns number+head+labels, and is empty when gh fails (offline)', async () => {
  const exec = fakeGh({ prList: [{ number: 1, headRefName: 'integration/x' }, { number: 2, headRefName: 'contrib/patch', labels: [{ name: 'neutral:adopt' }] }] })
  assert.deepEqual(await listOpenPRs('/r', exec), [
    { number: 1, headRefName: 'integration/x', labels: [] },
    { number: 2, headRefName: 'contrib/patch', labels: ['neutral:adopt'] }
  ])
  assert.deepEqual(await listOpenPRs('/r', fakeGh({ fail: true })), [])
})

test('normalizePR fills stable defaults from a raw gh object', () => {
  assert.deepEqual(normalizePR({ number: 3, headRefName: 'integration/y', baseRefName: 'main', isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [{ state: 'SUCCESS' }], headRefOid: 'deadbeef', body: 'b', labels: [{ name: 'neutral:stuck' }, { name: 'enhancement' }] }), {
    number: 3, head: 'integration/y', base: 'main', isDraft: true,
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', rollup: [{ state: 'SUCCESS' }], headSha: 'deadbeef', body: 'b',
    labels: ['neutral:stuck', 'enhancement'], canPush: true
  })
  // missing fields default rather than throw — UNKNOWN mergeability becomes "wait" downstream
  const d = normalizePR({ number: 4 })
  assert.equal(d.mergeable, 'UNKNOWN')
  assert.deepEqual(d.rollup, [])
  assert.deepEqual(d.labels, []) // absent labels default to [] (no stuck short-circuit)
  assert.equal(d.canPush, true) // same-repo (not cross) ⇒ always pushable
})

test('normalizePR canPush: a cross-repo fork is pushable only with maintainerCanModify (LLP 0025)', () => {
  assert.equal(normalizePR({ number: 1, isCrossRepository: true, maintainerCanModify: false }).canPush, false)
  assert.equal(normalizePR({ number: 2, isCrossRepository: true, maintainerCanModify: true }).canPush, true)
  assert.equal(normalizePR({ number: 3, isCrossRepository: false }).canPush, true)
})

test('viewPR observes one PR; null on gh failure', async () => {
  const exec = fakeGh({ prView: { number: 5, headRefName: 'integration/z', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', headRefOid: 'cafe', statusCheckRollup: [] } })
  const obs = await viewPR('/r', 5, exec)
  assert.equal(obs?.mergeStateStatus, 'DIRTY')
  assert.equal(await viewPR('/r', 5, fakeGh({ fail: true })), null)
})

test('listLabelledIssues flattens label objects to names', async () => {
  const exec = fakeGh({ issueList: [{ number: 7, title: 'crash on save', labels: [{ name: 'neutral:fix' }, { name: 'bug' }] }] })
  assert.deepEqual(await listLabelledIssues('/r', 'neutral:fix', exec), [
    { number: 7, title: 'crash on save', labels: ['neutral:fix', 'bug'] }
  ])
  assert.deepEqual(await listLabelledIssues('/r', 'neutral:fix', fakeGh({ fail: true })), [])
})

test('listOpenPRBodies returns bodies for Fixes #N scanning', async () => {
  const exec = fakeGh({ prBodies: [{ number: 8, body: 'Fixes #7', headRefName: 'fix/issue-7' }] })
  assert.deepEqual(await listOpenPRBodies('/r', exec), [{ number: 8, body: 'Fixes #7', headRefName: 'fix/issue-7' }])
})
