// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectPRs } from '../src/commands/prs.js'
import { collectIssues } from '../src/commands/issues.js'

/**
 * A fake runner that answers both `git` (for-each-ref) and `gh` (pr/issue), so the
 * maintenance observe surface can be exercised fully offline.
 * @param {{prs?: any[], views?: Record<number, any>, issues?: any[], fixBranches?: string[], mergedPrs?: any[]}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeWorld({ prs = [], views = {}, issues = [], fixBranches = [], mergedPrs = [] } = {}) {
  return async (cmd, args) => {
    if (cmd === 'git' && args[0] === 'for-each-ref') {
      // only the `fix/*` lookup is exercised here
      return fixBranches.join('\n') + '\n'
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      if (args[args.indexOf('--state') + 1] === 'merged') {
        return JSON.stringify(mergedPrs.map(p => ({ number: p.number, headRefName: p.headRefName, labels: p.labels || [] })))
      }
      const fields = args[args.indexOf('--json') + 1]
      return JSON.stringify(prs.map(p => fields.includes('body')
        ? { number: p.number, body: p.body || '', headRefName: p.headRefName }
        : { number: p.number, headRefName: p.headRefName, labels: p.labels || [] }))
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

test('collectPRs adopts a foreign PR labelled neutral:adopt; an unlabelled foreign PR stays out of scope (LLP 0025)', async () => {
  const exec = fakeWorld({
    prs: [
      { number: 3, headRefName: 'feature/from-a-human' },                          // foreign, NO label -> excluded
      { number: 4, headRefName: 'contrib/patch', labels: [{ name: 'neutral:adopt' }] } // adopted -> in scope
    ],
    views: {
      4: { number: 4, headRefName: 'contrib/patch', baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [], headRefOid: 'ddd', body: '', isCrossRepository: true, maintainerCanModify: true }
    }
  })
  const got = await collectPRs('/r', exec)
  // only #4 is picked up; a pushable fork with an unreviewed head -> review
  assert.deepEqual(got.map(p => [p.number, p.foreign, p.canPush, p.action]), [[4, true, true, 'review']])
})

test('collectPRs review-only degrades an unpushable fork to request-changes on a stale base (LLP 0025)', async () => {
  const exec = fakeWorld({
    prs: [{ number: 5, headRefName: 'contrib/patch', labels: [{ name: 'neutral:adopt' }] }],
    views: {
      5: { number: 5, headRefName: 'contrib/patch', baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND', statusCheckRollup: [], headRefOid: 'eee', body: '', isCrossRepository: true, maintainerCanModify: false }
    }
  })
  const got = await collectPRs('/r', exec)
  assert.deepEqual(got.map(p => [p.number, p.foreign, p.canPush, p.action]), [[5, true, false, 'request-changes']])
})

test('collectPRs scopes a neutral:review PR as review-only, even when pushable; review wins over adopt (LLP 0032)', async () => {
  const exec = fakeWorld({
    prs: [
      { number: 6, headRefName: 'contrib/one', labels: [{ name: 'neutral:review' }] },                              // review-only by label
      { number: 7, headRefName: 'contrib/two', labels: [{ name: 'neutral:adopt' }, { name: 'neutral:review' }] }    // both -> narrower grant wins
    ],
    views: {
      // same-repo branch (canPush true) sitting BEHIND: adopt would heal (merge-base); review must not
      6: { number: 6, headRefName: 'contrib/one', baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND', statusCheckRollup: [], headRefOid: 'aaa', body: '', labels: [{ name: 'neutral:review' }] },
      7: { number: 7, headRefName: 'contrib/two', baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND', statusCheckRollup: [], headRefOid: 'bbb', body: '', labels: [{ name: 'neutral:adopt' }, { name: 'neutral:review' }] }
    }
  })
  const got = await collectPRs('/r', exec)
  assert.deepEqual(got.map(p => [p.number, p.foreign, p.reviewOnly, p.canPush, p.action]), [
    [6, true, true, true, 'request-changes'],
    [7, true, true, true, 'request-changes']
  ])
})

test('collectPRs owes a merged adoption its completion record exactly once (LLP 0031)', async () => {
  const exec = fakeWorld({
    mergedPrs: [
      { number: 6, headRefName: 'contrib/patch', labels: [{ name: 'neutral:adopt' }, { name: 'neutral:approved' }] }, // owed
      { number: 7, headRefName: 'contrib/other', labels: [{ name: 'neutral:adopt' }, { name: 'neutral:adopted' }] },  // recorded -> silent
      { number: 8, headRefName: 'integration/own', labels: [{ name: 'neutral:adopt' }] }                              // own head -> not an adoption
    ]
  })
  const got = await collectPRs('/r', exec)
  assert.deepEqual(got.map(p => [p.number, p.rung, p.action]), [[6, 'terminal', 'mark-adopted']])
})

test('collectPRs surfaces the unstick action and the guidance count for a stuck PR with a human reply (LLP 0027)', async () => {
  const exec = fakeWorld({
    prs: [{ number: 5, headRefName: 'integration/auth' }],
    views: {
      5: {
        number: 5, headRefName: 'integration/auth', baseRefName: 'main', isDraft: true,
        mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [], headRefOid: 'abc1234',
        labels: [{ name: 'neutral:stuck' }],
        comments: [
          { author: { login: 'phil' }, body: '<!-- neutral-stuck: abc1234 -->\nStuck: which auth flow?', createdAt: '1' },
          { author: { login: 'phil' }, body: 'use OAuth device flow', createdAt: '2' }
        ]
      }
    }
  })
  const [p] = await collectPRs('/r', exec)
  assert.equal(p.action, 'unstick')
  assert.equal(p.guidance, 1) // the reply rides along so later workers get it as context
})

test('collectPRs honours the maxReviewRounds config knob', async () => {
  // A mergeable, green PR whose head is unreviewed but already carries one review
  // round: with the default bound (2) it gets another review; with a config bound of
  // 1 it is past the cap and surfaced for triage (LLP 0017).
  const exec = fakeWorld({
    prs: [{ number: 1, headRefName: 'integration/auth' }],
    views: {
      1: {
        number: 1, headRefName: 'integration/auth', baseRefName: 'main', isDraft: true,
        mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [],
        headRefOid: 'ccccccc', body: 'context\n<!-- neutral-review: aaaaaaa -->'
      }
    }
  })
  const repo = mkdtempSync(join(tmpdir(), 'neutral-prs-'))
  try {
    // No config -> default bound of 2: one prior round is under the cap, so review.
    assert.equal((await collectPRs(repo, exec))[0].action, 'review')
    // Bound of 1: the prior round meets the cap, so triage.
    mkdirSync(join(repo, '.neutral'))
    writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ maxReviewRounds: 1 }))
    assert.equal((await collectPRs(repo, exec))[0].action, 'triage')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
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
