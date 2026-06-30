// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conventionBlock, withConventionBlock, CONVENTION_MARKER, CONVENTION_END } from '../src/commands/init.js'

// @ref LLP 0015#enforcement--seeded-convention-review-checked [tests]
test('withConventionBlock creates a block when CLAUDE.md is absent', () => {
  const out = withConventionBlock(null)
  assert.ok(out && out.includes(CONVENTION_MARKER) && out.includes(CONVENTION_END))
  assert.ok(out.includes('Immutable docs; change is a new request'))
  assert.ok(out.endsWith('\n'))
})

test('withConventionBlock treats an empty body the same as absent', () => {
  assert.equal(withConventionBlock(''), conventionBlock() + '\n')
  assert.equal(withConventionBlock('   \n'), conventionBlock() + '\n')
})

test('withConventionBlock appends to existing content, preserving it', () => {
  const existing = '# My Repo\n\nSome guidance.\n'
  const out = withConventionBlock(existing)
  assert.ok(out)
  assert.ok(out.startsWith('# My Repo\n\nSome guidance.'))
  assert.ok(out.includes(CONVENTION_MARKER))
  // Exactly one blank line between the prior content and the block — no triple newline.
  assert.ok(out.includes('Some guidance.\n\n' + CONVENTION_MARKER))
})

test('withConventionBlock is idempotent once the marker is present', () => {
  const seeded = withConventionBlock('# My Repo\n')
  assert.ok(seeded)
  assert.equal(withConventionBlock(seeded), null)
})
