// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBaseline } from '../src/baseline.js'
import { isNeutralDesign, isDesignType } from '../src/llp.js'

/**
 * @param {any} contents
 * @returns {string}
 */
function repoWithBaseline(contents) {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-base-'))
  mkdirSync(join(repo, '.neutral'))
  writeFileSync(join(repo, '.neutral', 'baseline.json'), JSON.stringify(contents))
  return repo
}

test('loadBaseline reads grandfathered request numbers (object form)', () => {
  const repo = repoWithBaseline({ grandfathered: [{ llp: 12, reason: 'shipped pre-neutral' }, { llp: 13 }] })
  try {
    assert.deepEqual([...loadBaseline(repo)].sort((a, b) => a - b), [12, 13])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('loadBaseline accepts a bare number list and is empty when absent', () => {
  const repo = repoWithBaseline([7, 8])
  try {
    assert.deepEqual([...loadBaseline(repo)].sort((a, b) => a - b), [7, 8])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
  const empty = mkdtempSync(join(tmpdir(), 'neutral-base-'))
  try {
    assert.equal(loadBaseline(empty).size, 0)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('isNeutralDesign distinguishes neutral-minted designs from the project\'s own', () => {
  const base = { number: 5, slug: 's', title: 't', status: 'Active', systems: [], author: '', date: '', path: '', refs: [], dependsOn: [] }
  const mine = { ...base, type: 'plan', generatedBy: 'neutral' }
  const theirs = { ...base, type: 'plan' }            // a human planning doc
  assert.equal(isDesignType(mine), true)
  assert.equal(isDesignType(theirs), true)            // both count for coverage
  assert.equal(isNeutralDesign(mine), true)           // ...but only neutral's drives the pipeline
  assert.equal(isNeutralDesign(theirs), false)
})
