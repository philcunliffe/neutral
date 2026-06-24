// @ts-check
// @ref LLP 0004 [tests] — the `neutral llp <number>` command
// @ref LLP 0005 [tests] — its resolve/role/coverage behavior
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { llpCommand, llpRole } from '../src/commands/llp.js'

/**
 * Build a throwaway repo with an `llp/` corpus and return its path.
 * @param {Record<string, string>} files  filename -> body
 * @returns {string}
 */
function fixtureRepo(files) {
  const repo = mkdtempSync(join(tmpdir(), 'neutral-llp-'))
  mkdirSync(join(repo, 'llp'))
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(repo, 'llp', name), body)
  }
  return repo
}

/**
 * Run a command while capturing stdout/stderr and its exit code.
 * @param {(repo: string, args: string[]) => number} fn
 * @param {string} repo
 * @param {string[]} args
 * @returns {{ code: number, out: string, err: string }}
 */
function capture(fn, repo, args) {
  let out = ''
  let err = ''
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  process.stdout.write = s => { out += s; return true }
  process.stderr.write = s => { err += s; return true }
  try {
    const code = fn(repo, args)
    return { code, out, err }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

const SPEC = [
  '# LLP 0004: A request',
  '',
  '**Type:** spec',
  '**Status:** Accepted',
  '**Systems:** Engine',
  '**Author:** Phil',
  '**Date:** 2026-06-23',
  ''
].join('\n')

const DESIGN = [
  '# LLP 0005: A design',
  '',
  '**Type:** design',
  '**Status:** Active',
  '**Systems:** Engine',
  '**Author:** Phil',
  '**Date:** 2026-06-23',
  '',
  '@ref LLP 0004 — covers the request'
].join('\n')

test('llpRole maps type to its pipeline role', () => {
  const base = { slug: '', title: '', status: '', systems: [], author: '', date: '', path: '', refs: [], dependsOn: [] }
  assert.equal(llpRole({ ...base, number: 1, type: 'spec' }), 'request')
  assert.equal(llpRole({ ...base, number: 2, type: 'design' }), 'design')
  assert.equal(llpRole({ ...base, number: 3, type: 'principle' }), 'background')
})

test('a known number prints its fields, role, and covered-by design', () => {
  const repo = fixtureRepo({
    '0004-a-request.spec.md': SPEC,
    '0005-a-design.design.md': DESIGN
  })
  try {
    // unpadded input resolves the same LLP as padded
    const { code, out } = capture(llpCommand, repo, ['4'])
    assert.equal(code, 0)
    assert.match(out, /LLP 0004/)
    assert.match(out, /A request/)
    assert.match(out, /spec \(request\)/)
    assert.match(out, /Accepted/)
    assert.match(out, /Engine/)
    // the request is covered by design 0005
    assert.match(out, /covered\s+by 0005/)

    // the design lists the request it covers
    const design = capture(llpCommand, repo, ['0005'])
    assert.equal(design.code, 0)
    assert.match(design.out, /design \(design\)/)
    assert.match(design.out, /covers\s+0004/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('--json serializes the record plus role and coveredBy', () => {
  const repo = fixtureRepo({
    '0004-a-request.spec.md': SPEC,
    '0005-a-design.design.md': DESIGN
  })
  try {
    const { code, out } = capture(llpCommand, repo, ['0004', '--json'])
    assert.equal(code, 0)
    const rec = JSON.parse(out)
    assert.equal(rec.number, 4)
    assert.equal(rec.type, 'spec')
    assert.equal(rec.role, 'request')
    assert.deepEqual(rec.coveredBy, ['0005'])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('an unknown number writes to stderr and exits 2', () => {
  const repo = fixtureRepo({ '0004-a-request.spec.md': SPEC })
  try {
    const { code, err } = capture(llpCommand, repo, ['99'])
    assert.equal(code, 2)
    assert.match(err, /no LLP with number 0099/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a missing or non-numeric argument prints usage and exits 2', () => {
  const repo = fixtureRepo({ '0004-a-request.spec.md': SPEC })
  try {
    const missing = capture(llpCommand, repo, [])
    assert.equal(missing.code, 2)
    assert.match(missing.err, /usage: neutral llp/)

    const bad = capture(llpCommand, repo, ['xyz'])
    assert.equal(bad.code, 2)
    assert.match(bad.err, /usage: neutral llp/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
