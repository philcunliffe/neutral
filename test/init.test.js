// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { conventionBlock, withConventionBlock, CONVENTION_MARKER, CONVENTION_END, llpCheckWorkflow, LLP_CHECK_PATH } from '../src/commands/init.js'

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

// @ref LLP 0048#generated-workflow [tests]
test('llpCheckWorkflow runs on PRs and default-branch pushes, over the configured llpDir', () => {
  const yml = llpCheckWorkflow('llp')
  assert.ok(yml.includes('pull_request'))
  assert.ok(yml.includes('branches: [main, master]'))
  assert.ok(yml.includes('find llp '))
  assert.ok(yml.includes('llp/reviews'))
  assert.ok(yml.includes('exit 1'))
  assert.equal(LLP_CHECK_PATH, '.github/workflows/llp-check.yml')
  // llpDir is parameterized, trailing slash tolerated
  const docs = llpCheckWorkflow('docs/llp/')
  assert.ok(docs.includes('find docs/llp '))
  assert.ok(docs.includes('docs/llp/reviews'))
})

/**
 * Extract the `run: |` block from the generated YAML as a runnable sh script.
 * @param {string} yml
 * @returns {string}
 */
function runBlock(yml) {
  const lines = yml.split('\n')
  const start = lines.findIndex(l => l.trim() === 'run: |')
  assert.ok(start >= 0)
  return lines.slice(start + 1).filter(l => l.startsWith('          ')).map(l => l.slice(10)).join('\n')
}

/** @param {Record<string, string>} files  relpath -> content */
function shellCheck(files) {
  const dir = mkdtempSync(join(tmpdir(), 'llp-check-'))
  try {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), content)
    }
    return spawnSync('sh', ['-ec', runBlock(llpCheckWorkflow('llp'))], { cwd: dir, encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// @ref LLP 0048#check-over-claiming [tests] — the invariant is derived from the tree
test('the generated check passes a clean tree, counting tombstones as occupied', () => {
  const res = shellCheck({
    'llp/0001-a.spec.md': '',
    'llp/0002-b.decision.md': '',
    'llp/tombstones/0003-c.rfc.md': ''
  })
  assert.equal(res.status, 0, res.stderr)
})

test('the generated check fails on a duplicate number and names both files', () => {
  const res = shellCheck({
    'llp/0007-a.spec.md': '',
    'llp/0007-b.decision.md': ''
  })
  assert.equal(res.status, 1)
  assert.ok(res.stderr.includes('0007-a.spec.md'))
  assert.ok(res.stderr.includes('0007-b.decision.md'))
  assert.ok(res.stderr.includes('renumber'))
})

test('the generated check fails when a live doc reuses a tombstoned number', () => {
  const res = shellCheck({
    'llp/0005-new.spec.md': '',
    'llp/tombstones/0005-old.rfc.md': ''
  })
  assert.equal(res.status, 1)
})

test('the generated check ignores reviews/ and non-LLP files', () => {
  const res = shellCheck({
    'llp/0001-a.spec.md': '',
    'llp/reviews/0001-a.review-claude.md': '',
    'llp/reviews/0001-a.review-gpt.md': '',
    'llp/README.md': ''
  })
  assert.equal(res.status, 0, res.stderr)
})
