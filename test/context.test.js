// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  contextSizeFromTranscript, usageOf, projectSlug, transcriptPath, readContextSize
} from '../src/context.js'

/**
 * Build a transcript line carrying a nested message.usage (the common assistant shape).
 * @param {number} input @param {number} cacheCreate @param {number} cacheRead @param {number} output
 */
function turn(input, cacheCreate, cacheRead, output) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', usage: {
      input_tokens: input, cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead, output_tokens: output
    } }
  })
}

test('contextSizeFromTranscript sums the LAST usage record (carried context, not output)', () => {
  const text = [
    turn(2, 100, 1000, 50),       // earlier turn — ignored
    JSON.stringify({ type: 'user', message: { role: 'user' } }), // no usage — skipped
    turn(5, 200, 80000, 3000)     // last usage record — counted
  ].join('\n')
  // 5 + 200 + 80000 = 80205 (output_tokens 3000 is NOT carried context)
  assert.equal(contextSizeFromTranscript(text), 80205)
})

test('contextSizeFromTranscript reads a top-level usage too, tolerates garbled/blank lines, defaults to 0', () => {
  assert.equal(contextSizeFromTranscript(''), 0)
  assert.equal(contextSizeFromTranscript('not json\n\n  \n'), 0)
  const topLevel = JSON.stringify({ usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } })
  assert.equal(contextSizeFromTranscript('garbage{\n' + topLevel + '\n'), 6)
  // missing sub-fields treated as 0
  assert.equal(contextSizeFromTranscript(JSON.stringify({ usage: { input_tokens: 7 } })), 7)
})

test('usageOf finds usage at the top level or under message, else null', () => {
  assert.deepEqual(usageOf({ usage: { input_tokens: 1 } }), { input_tokens: 1 })
  assert.deepEqual(usageOf({ message: { usage: { input_tokens: 2 } } }), { input_tokens: 2 })
  assert.equal(usageOf({ message: { role: 'user' } }), null)
  assert.equal(usageOf(null), null)
  assert.equal(usageOf('string'), null)
})

test('projectSlug replaces every non-alphanumeric with a dash (Claude Code layout)', () => {
  assert.equal(projectSlug('/Users/phil/workspace/neutral'), '-Users-phil-workspace-neutral')
  assert.equal(projectSlug('/Users/phil/.codex/x'), '-Users-phil--codex-x')
})

test('transcriptPath builds ~/.claude/projects/<slug>/<id>.jsonl', () => {
  assert.equal(
    transcriptPath('/home/me', '/work/repo', 'SID-1'),
    join('/home/me', '.claude', 'projects', '-work-repo', 'SID-1.jsonl')
  )
})

test('readContextSize locates the session transcript by id + cwd, and via an explicit path', () => {
  const home = mkdtempSync(join(tmpdir(), 'neutral-ctx-'))
  try {
    const cwd = '/work/repo'
    const sessionId = 'sess-abc'
    const dir = join(home, '.claude', 'projects', projectSlug(cwd))
    mkdirSync(dir, { recursive: true })
    const p = join(dir, `${sessionId}.jsonl`)
    writeFileSync(p, turn(10, 20, 30, 999) + '\n')

    assert.equal(readContextSize({ home, cwd, sessionId }), 60)        // by id + cwd
    assert.equal(readContextSize({ path: p }), 60)                     // by explicit path
    assert.equal(readContextSize({ home, cwd, sessionId: 'missing' }), null) // not found -> null
    assert.equal(readContextSize({ home, cwd }), null)                 // no session id -> null
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('readContextSize falls back to scanning project dirs when the slug path misses', () => {
  const home = mkdtempSync(join(tmpdir(), 'neutral-ctx-'))
  try {
    const sessionId = 'sess-elsewhere'
    // Transcript lives under a DIFFERENT slug than the cwd we pass.
    const dir = join(home, '.claude', 'projects', '-some-other-launch-dir')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${sessionId}.jsonl`), turn(1, 1, 1, 0) + '\n')
    assert.equal(readContextSize({ home, cwd: '/work/repo', sessionId }), 3)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
