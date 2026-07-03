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

test('parseTasks reads the optional complexity rating (LLP 0022)', () => {
  const rated = `## Tasks
- id: T1  branch: task/x/T1  deps: []              complexity: 2  -- rated, with brief
- id: T2  branch: task/x/T2  deps: [T1]  complexity: 5
- id: T3  branch: task/x/T3  deps: [T1]            -- unrated
`
  const tasks = parseTasks(rated)
  assert.equal(tasks[0].complexity, 2)
  assert.equal(tasks[0].brief, 'rated, with brief')
  assert.equal(tasks[1].complexity, 5)
  assert.equal(tasks[1].brief, undefined)
  assert.equal(tasks[2].complexity, undefined) // absent ⇒ mechanical entry
  assert.equal(tasks[2].brief, 'unrated')
})

test('parseTasks fails loudly on a complexity out of range or non-integer', () => {
  assert.throws(() => parseTasks('## Tasks\n- id: T1  branch: b  deps: []  complexity: 6\n'), /complexity must be an integer 1–5/)
  assert.throws(() => parseTasks('## Tasks\n- id: T1  branch: b  deps: []  complexity: 0\n'), /complexity must be an integer 1–5/)
  assert.throws(() => parseTasks('## Tasks\n- id: T1  branch: b  deps: []  complexity: high\n'), /complexity must be an integer 1–5/)
})

test('parseTasks rejects duplicate ids, unknown deps, and cycles', () => {
  const dup = '## Tasks\n- id: T1  branch: b1  deps: []\n- id: T1  branch: b2  deps: []\n'
  assert.throws(() => parseTasks(dup), /duplicate task id/)

  const unknown = '## Tasks\n- id: T1  branch: b1  deps: [T9]\n'
  assert.throws(() => parseTasks(unknown), /unknown task T9/)

  const cycle = '## Tasks\n- id: A  branch: a  deps: [B]\n- id: B  branch: b  deps: [A]\n'
  assert.throws(() => parseTasks(cycle), /cycle/)
})
