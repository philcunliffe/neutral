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
