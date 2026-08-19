// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js'

test('loadConfig returns defaults when there is no .neutral/config.json', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    assert.deepEqual(loadConfig(repo), DEFAULT_CONFIG)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('loadConfig merges a partial config over the defaults', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    mkdirSync(join(repo, '.neutral'))
    writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({
      llpDir: 'docs/llp',
      roles: { request: ['spec'], design: ['design'] }
    }))
    const cfg = loadConfig(repo)
    assert.equal(cfg.llpDir, 'docs/llp')                 // overridden
    assert.deepEqual(cfg.roles.request, ['spec'])        // overridden (plan no longer a design here)
    assert.deepEqual(cfg.roles.design, ['design'])
    assert.deepEqual(cfg.liveStatuses, DEFAULT_CONFIG.liveStatuses) // untouched -> default
    assert.deepEqual(cfg.code.exts, DEFAULT_CONFIG.code.exts)       // untouched -> default
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('loadConfig accepts a positive integer maxReviewRounds, else keeps the default', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    mkdirSync(join(repo, '.neutral'))
    /** @param {unknown} v */
    const write = (v) => writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ maxReviewRounds: v }))
    write(5)
    assert.equal(loadConfig(repo).maxReviewRounds, 5)
    write(0)                                                          // not positive -> default
    assert.equal(loadConfig(repo).maxReviewRounds, DEFAULT_CONFIG.maxReviewRounds)
    write('3')                                                        // not an integer -> default
    assert.equal(loadConfig(repo).maxReviewRounds, DEFAULT_CONFIG.maxReviewRounds)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('loadConfig accepts a boolean automerge, else keeps the default (off)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    assert.equal(DEFAULT_CONFIG.automerge, false) // hold-for-a-human is the default (LLP 0019)
    mkdirSync(join(repo, '.neutral'))
    /** @param {unknown} v */
    const write = (v) => writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ automerge: v }))
    write(true)
    assert.equal(loadConfig(repo).automerge, true)
    write(false)
    assert.equal(loadConfig(repo).automerge, false)
    write('true')                                                     // not a boolean -> default
    assert.equal(loadConfig(repo).automerge, false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('loadConfig accepts mergeQueue and a non-negative maxActiveWork (LLP 0060)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    assert.equal(DEFAULT_CONFIG.mergeQueue, false)
    assert.equal(DEFAULT_CONFIG.maxActiveWork, 4)
    mkdirSync(join(repo, '.neutral'))
    const path = join(repo, '.neutral', 'config.json')
    writeFileSync(path, JSON.stringify({ mergeQueue: true, maxActiveWork: 3 }))
    assert.equal(loadConfig(repo).mergeQueue, true)
    assert.equal(loadConfig(repo).maxActiveWork, 3)
    writeFileSync(path, JSON.stringify({ mergeQueue: 'yes', maxActiveWork: -1 }))
    assert.equal(loadConfig(repo).mergeQueue, false)
    assert.equal(loadConfig(repo).maxActiveWork, 4)
    writeFileSync(path, JSON.stringify({ maxActiveWork: 0 }))
    assert.equal(loadConfig(repo).maxActiveWork, 0) // explicit intake stop
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('loadConfig accepts a boolean autophagy.codeCleanup, else keeps the default (on)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    assert.equal(DEFAULT_CONFIG.autophagy.codeCleanup, true) // held-PR boundary is the safety (LLP 0036)
    mkdirSync(join(repo, '.neutral'))
    /** @param {unknown} v */
    const write = (v) => writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ autophagy: v }))
    write({ codeCleanup: false })
    assert.equal(loadConfig(repo).autophagy.codeCleanup, false)
    write({ codeCleanup: 'false' })                                   // not a boolean -> default
    assert.equal(loadConfig(repo).autophagy.codeCleanup, true)
    write('off')                                                      // not an object -> default
    assert.equal(loadConfig(repo).autophagy.codeCleanup, true)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('loadConfig accepts non-negative integer autophagy cooldowns, else keeps defaults (LLP 0047)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    assert.equal(DEFAULT_CONFIG.autophagy.cooldownAfterMergeHours, 24)
    assert.equal(DEFAULT_CONFIG.autophagy.cooldownAfterRejectHours, 168)
    mkdirSync(join(repo, '.neutral'))
    /** @param {unknown} v */
    const write = (v) => writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ autophagy: v }))
    write({ cooldownAfterMergeHours: 6, cooldownAfterRejectHours: 72 })
    assert.equal(loadConfig(repo).autophagy.cooldownAfterMergeHours, 6)
    assert.equal(loadConfig(repo).autophagy.cooldownAfterRejectHours, 72)
    write({ cooldownAfterMergeHours: 0 })                              // 0 is valid — disables the arm
    assert.equal(loadConfig(repo).autophagy.cooldownAfterMergeHours, 0)
    write({ cooldownAfterMergeHours: -3 })                            // negative -> default
    assert.equal(loadConfig(repo).autophagy.cooldownAfterMergeHours, 24)
    write({ cooldownAfterRejectHours: 1.5 })                          // non-integer -> default
    assert.equal(loadConfig(repo).autophagy.cooldownAfterRejectHours, 168)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a config can remap `plan` out of the design role', () => {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-cfg-'))
  try {
    mkdirSync(join(repo, '.neutral'))
    writeFileSync(join(repo, '.neutral', 'config.json'), JSON.stringify({ roles: { design: ['design'] } }))
    assert.ok(!loadConfig(repo).roles.design.includes('plan'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
