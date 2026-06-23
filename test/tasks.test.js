// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTasks } from '../src/tasks.js'

const PLAN = `# LLP 0099: Example plan

**Type:** plan

## Design notes

Some prose.

## Tasks
- id: T1  branch: task/example/T1  deps: []        -- scaffold
- id: T2  branch: task/example/T2  deps: [T1]      -- build on T1
- id: T3  branch: task/example/T3  deps: [T1, T2]  -- finish

## References
- nothing
`

test('parseTasks reads ids, branches, deps, and the brief', () => {
  const tasks = parseTasks(PLAN)
  assert.deepEqual(tasks.map(t => t.id), ['T1', 'T2', 'T3'])
  assert.equal(tasks[2].branch, 'task/example/T3')
  assert.deepEqual(tasks[1].deps, ['T1'])
  assert.deepEqual(tasks[2].deps, ['T1', 'T2'])
  assert.equal(tasks[0].brief, 'scaffold')
})

test('parseTasks stops at the next heading (ignores ## References)', () => {
  assert.equal(parseTasks(PLAN).length, 3)
})

test('parseTasks throws when there is no Tasks section', () => {
  assert.throws(() => parseTasks('# LLP\n\nno tasks here'), /no "## Tasks" section/)
})

test('parseTasks fails loudly on a malformed task line', () => {
  const bad = '## Tasks\n- id: T1 branch task/x/T1 deps []\n'
  assert.throws(() => parseTasks(bad), /malformed task line/)
})

test('parseTasks rejects duplicate ids, unknown deps, and cycles', () => {
  const dup = '## Tasks\n- id: T1  branch: b1  deps: []\n- id: T1  branch: b2  deps: []\n'
  assert.throws(() => parseTasks(dup), /duplicate task id/)

  const unknown = '## Tasks\n- id: T1  branch: b1  deps: [T9]\n'
  assert.throws(() => parseTasks(unknown), /unknown task T9/)

  const cycle = '## Tasks\n- id: A  branch: a  deps: [B]\n- id: B  branch: b  deps: [A]\n'
  assert.throws(() => parseTasks(cycle), /cycle/)
})
