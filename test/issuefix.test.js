// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixBranchName, fixedIssueNumbers, classifyIssue } from '../src/issuefix.js'

test('fixBranchName is the conventional, idempotency-keyed branch', () => {
  assert.equal(fixBranchName(42), 'fix/issue-42')
})

test('fixedIssueNumbers recognises the GitHub closing-keyword set', () => {
  assert.deepEqual(fixedIssueNumbers('blah\n\nFixes #12'), [12])
  assert.deepEqual(fixedIssueNumbers('Closes #3 and fixed #4, resolves #5'), [3, 4, 5])
  assert.deepEqual(fixedIssueNumbers('Fix: #7'), [7])
  assert.deepEqual(fixedIssueNumbers('mentions #9 but does not close it'), [])
  assert.deepEqual(fixedIssueNumbers(''), [])
})

test('classifyIssue: a neutral:stuck label wins — a human must look', () => {
  assert.deepEqual(
    classifyIssue(5, { labels: ['neutral:fix', 'neutral:stuck'], branches: ['fix/issue-5'] }),
    { state: 'stuck', via: 'label:neutral:stuck' }
  )
})

test('classifyIssue: an existing fix branch is an attempt (resume, never duplicate)', () => {
  assert.deepEqual(
    classifyIssue(8, { branches: ['main', 'fix/issue-8'] }),
    { state: 'attempt-exists', via: 'branch:fix/issue-8' }
  )
  // tolerate a remote-tracking prefix
  assert.deepEqual(
    classifyIssue(8, { branches: ['origin/fix/issue-8'] }),
    { state: 'attempt-exists', via: 'branch:fix/issue-8' }
  )
})

test('classifyIssue: a Fixes #N PR is an attempt even with no branch observed', () => {
  assert.deepEqual(
    classifyIssue(11, { prs: [{ number: 20, body: 'work\nFixes #11' }] }),
    { state: 'attempt-exists', via: 'pr:#20' }
  )
})

test('classifyIssue: no branch, no PR, no stuck label -> needs-fix', () => {
  assert.deepEqual(
    classifyIssue(99, { branches: ['fix/issue-1'], prs: [{ number: 2, body: 'Fixes #1' }], labels: ['neutral:fix'] }),
    { state: 'needs-fix' }
  )
  assert.deepEqual(classifyIssue(99, {}), { state: 'needs-fix' })
})
