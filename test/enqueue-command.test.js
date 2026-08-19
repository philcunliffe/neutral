// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enqueuePR } from '../src/commands/enqueue.js'

test('enqueuePR guards the reviewed head and calls the dedicated queue mutation (LLP 0061)', async () => {
  /** @type {Array<{cmd: string, args: string[]}>} */
  const calls = []
  /** @type {import('../src/git.js').run} */
  const exec = async (cmd, args) => {
    calls.push({ cmd, args })
    if (args[0] === 'pr') return JSON.stringify({ id: 'PR_node', headRefOid: 'abc1234' })
    return JSON.stringify({ data: { enqueuePullRequest: { mergeQueueEntry: { id: 'MQE_node', position: 2, state: 'QUEUED' } } } })
  }

  const got = await enqueuePR('/r', 7, 'abc1234', exec)
  assert.deepEqual(got, { number: 7, headSha: 'abc1234', id: 'MQE_node', position: 2, state: 'QUEUED' })
  assert.deepEqual(calls[0], { cmd: 'gh', args: ['pr', 'view', '7', '--json', 'id,headRefOid'] })
  assert.equal(calls[1].cmd, 'gh')
  assert.deepEqual(calls[1].args.slice(0, 2), ['api', 'graphql'])
  assert.ok(calls[1].args.includes('id=PR_node'))
  assert.ok(calls[1].args.includes('oid=abc1234'))
  assert.match(calls[1].args.find(a => a.startsWith('query=')) || '', /expectedHeadOid:\$oid/)
})

test('enqueuePR refuses a moved head before mutating GitHub', async () => {
  let calls = 0
  /** @type {import('../src/git.js').run} */
  const exec = async () => {
    calls++
    return JSON.stringify({ id: 'PR_node', headRefOid: 'newhead' })
  }
  await assert.rejects(() => enqueuePR('/r', 7, 'reviewedhead', exec), /head changed/)
  assert.equal(calls, 1)
})

test('enqueuePR requires GitHub to return a queue entry', async () => {
  /** @type {import('../src/git.js').run} */
  const exec = async (_cmd, args) => args[0] === 'pr'
    ? JSON.stringify({ id: 'PR_node', headRefOid: 'abc1234' })
    : JSON.stringify({ data: { enqueuePullRequest: { mergeQueueEntry: null } } })
  await assert.rejects(() => enqueuePR('/r', 7, 'abc1234', exec), /did not return/)
})
