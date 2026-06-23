// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readyTasks, topoOrder } from '../src/ready.js'

/** @type {import('../src/types.d.ts').Task[]} */
const tasks = [
  { id: 'T1', branch: 'b1', deps: [] },
  { id: 'T2', branch: 'b2', deps: ['T1'] },
  { id: 'T3', branch: 'b3', deps: ['T1'] },
  { id: 'T4', branch: 'b4', deps: ['T2', 'T3'] }
]

test('ready surfaces only unblocked open tasks as the done-set grows', () => {
  assert.deepEqual(readyTasks(tasks, new Set()).ready.map(t => t.id), ['T1'])
  assert.deepEqual(readyTasks(tasks, new Set(['T1'])).ready.map(t => t.id), ['T2', 'T3'])
  assert.deepEqual(readyTasks(tasks, new Set(['T1', 'T2', 'T3'])).ready.map(t => t.id), ['T4'])

  const all = readyTasks(tasks, new Set(['T1', 'T2', 'T3', 'T4']))
  assert.deepEqual(all.ready, [])
  assert.deepEqual(all.done.map(t => t.id), ['T1', 'T2', 'T3', 'T4'])
})

test('a task with one unmet dep is blocked, not ready', () => {
  const r = readyTasks(tasks, new Set(['T1', 'T2']))
  assert.deepEqual(r.ready.map(t => t.id), ['T3'])
  assert.deepEqual(r.blocked.map(t => t.id), ['T4'])
})

test('topoOrder places dependencies before dependents', () => {
  const order = topoOrder(tasks).map(t => t.id)
  for (const t of tasks) {
    for (const d of t.deps) {
      assert.ok(order.indexOf(d) < order.indexOf(t.id), `${d} must precede ${t.id}`)
    }
  }
})

test('topoOrder throws on a dependency cycle', () => {
  /** @type {import('../src/types.d.ts').Task[]} */
  const cyclic = [
    { id: 'A', branch: 'a', deps: ['B'] },
    { id: 'B', branch: 'b', deps: ['A'] }
  ]
  assert.throws(() => topoOrder(cyclic), /cycle/)
})
