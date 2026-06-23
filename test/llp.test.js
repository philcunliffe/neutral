// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLlp, normalizeStatus, needsCoverage, isDesignType } from '../src/llp.js'

test('normalizeStatus strips version + parentheticals', () => {
  assert.equal(normalizeStatus('Draft v2'), 'Draft')
  assert.equal(normalizeStatus('Accepted (pending implementation)'), 'Accepted')
  assert.equal(normalizeStatus('  Active '), 'Active')
})

test('parseLlp extracts number, slug, type, title, status, refs, dependsOn', () => {
  const body = [
    '# LLP 0071: Auth overhaul',
    '',
    '**Type:** design',
    '**Status:** Active',
    '**Systems:** Auth, Security',
    '**Depends-on:** 0065, infra-bootstrap',
    '**Generated-by:** neutral',
    '',
    'Covers the auth requests.',
    '@ref LLP 0042 — login',
    '@ref LLP 0043 — sessions'
  ].join('\n')
  const llp = parseLlp('0071-auth-overhaul.design.md', body)
  if (!llp) throw new Error('expected a parsed LLP')
  assert.equal(llp.number, 71)
  assert.equal(llp.slug, 'auth-overhaul')
  assert.equal(llp.type, 'design')
  assert.equal(llp.title, 'Auth overhaul')
  assert.equal(llp.status, 'Active')
  assert.deepEqual(llp.systems, ['Auth', 'Security'])
  assert.deepEqual(llp.refs, [42, 43])
  assert.deepEqual(llp.dependsOn, ['0065', 'infra-bootstrap'])
  assert.equal(llp.generatedBy, 'neutral')
  assert.equal(isDesignType(llp), true)
  assert.equal(needsCoverage(llp), false) // a design is not a request
})

test('parseLlp returns null for a non-LLP filename', () => {
  assert.equal(parseLlp('README.md', '# hi'), null)
})

test('tombstoned files are forced to Tombstoned regardless of header', () => {
  const llp = parseLlp('0009-legacy.decision.md', '# LLP 0009: Legacy\n\n**Status:** Active', true)
  if (!llp) throw new Error('expected a parsed LLP')
  assert.equal(llp.status, 'Tombstoned')
})
