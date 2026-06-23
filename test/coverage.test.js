// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverage } from '../src/coverage.js'
import { extractRefs } from '../src/refs.js'

/**
 * @param {number} number
 * @param {string} status
 * @param {string} [type]
 * @param {number[]} [refs]
 * @returns {import('../src/types.d.ts').Llp}
 */
const llp = (number, status, type = 'spec', refs = []) => ({
  number, slug: `llp-${number}`, type, title: `LLP ${number}`,
  status, systems: [], author: '', date: '', path: '', refs, dependsOn: []
})

/**
 * A design LLP covering the given request numbers.
 * @param {number} number
 * @param {number[]} refs
 * @returns {import('../src/types.d.ts').Llp}
 */
const design = (number, refs) => llp(number, 'Active', 'design', refs)

test('coverage flags out-of-draft requests not @ref-d by any design as the backlog', () => {
  const llps = [
    llp(10, 'Active'), llp(11, 'Accepted'), llp(12, 'Draft'), llp(13, 'Active'),
    design(7, [10, 11])
  ]
  const c = coverage(llps)
  // 12 is Draft (not live); 10/11 covered by design 0007; 13 is the backlog.
  assert.deepEqual(c.eligible.map(l => l.number), [10, 11, 13])
  assert.deepEqual(c.covered.map(x => x.llp.number), [10, 11])
  assert.deepEqual(c.uncovered.map(l => l.number), [13])
  assert.deepEqual(c.covered[0].by, ['0007'])
})

test('design and plan LLPs are never themselves requests — no infinite regress', () => {
  const llps = [design(7, []), llp(8, 'Active', 'plan', []), llp(9, 'Active', 'spec')]
  const c = coverage(llps)
  assert.deepEqual(c.eligible.map(l => l.number), [9])
  assert.deepEqual(c.designs.map(l => l.number), [7, 8])
})

test('a request realized in code is covered even without a design', () => {
  const c = coverage([llp(20, 'Active')], new Set([20]))
  assert.deepEqual(c.uncovered, [])
  assert.deepEqual(c.covered[0].by, ['code'])
})

test('meta types (explainer/principle/decision) are neither request nor design', () => {
  const llps = [
    llp(1, 'Active', 'explainer'), llp(2, 'Active', 'principle'),
    llp(3, 'Accepted', 'decision'), llp(4, 'Active', 'spec')
  ]
  const c = coverage(llps)
  assert.deepEqual(c.eligible.map(l => l.number), [4])
  assert.deepEqual(c.designs, [])
})

test('a request covered by two designs records both', () => {
  const llps = [llp(10, 'Active'), design(7, [10]), design(8, [10])]
  assert.deepEqual(coverage(llps).covered[0].by, ['0007', '0008'])
})

test('extractRefs parses @ref LLP annotations with padding, anchors, relations', () => {
  const text = [
    '// @ref LLP 0010#design — gloss',
    '# @ref LLP 7 [implements] — y',
    'prose mentioning LLP 99 without a @ref should not match',
    '<!-- @ref LLP 0010 — duplicate, deduped -->'
  ].join('\n')
  assert.deepEqual(extractRefs(text), [7, 10])
})
