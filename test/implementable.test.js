// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectImplementable, collectImplementable } from '../src/implementable.js'

/**
 * A minimal parsed design LLP, overridable per test.
 * @param {Partial<import('../src/types.d.ts').Llp>} over
 * @returns {import('../src/types.d.ts').Llp}
 */
function design(over = {}) {
  return {
    number: 45, slug: 'client-attach', type: 'design', title: 'Client attach',
    status: 'Accepted', systems: [], author: '', date: '', path: '', refs: [], dependsOn: [],
    ...over
  }
}

test('selectImplementable: an Accepted design with no integration branch is implementable', () => {
  assert.deepEqual(selectImplementable([design()], new Set()), [{ number: 45, slug: 'client-attach', title: 'Client attach' }])
})

test('selectImplementable: an Active design (already built/shipped) is NOT implementable', () => {
  assert.deepEqual(selectImplementable([design({ status: 'Active' })], new Set()), [])
})

test('selectImplementable: a design already in flight (integration/<slug> exists) is skipped', () => {
  assert.deepEqual(selectImplementable([design()], new Set(['client-attach'])), [])
})

test('selectImplementable: non-design types and Draft designs are ignored', () => {
  const items = selectImplementable(
    [design({ type: 'plan' }), design({ status: 'Draft' }), design({ type: 'decision' })],
    new Set()
  )
  assert.deepEqual(items, [])
})

/**
 * A fake world: `designs` maps a design path to its body on origin/<default>;
 * `integration` lists `for-each-ref` output (origin/-prefixed short names).
 * @param {{designs?: Record<string,string>, integration?: string[]}} cfg
 * @returns {import('../src/git.js').run}
 */
function fakeWorld({ designs = {}, integration = [] }) {
  return async (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'repo' && args[1] === 'view') return 'main\n'
    if (cmd === 'git' && args[0] === 'ls-tree') return Object.keys(designs).join('\n') + '\n'
    if (cmd === 'git' && args[0] === 'show') {
      const path = String(args[1]).split(':')[1]
      if (path in designs) return designs[path]
      const e = new Error('missing'); /** @type {any} */ (e).code = 128; throw e
    }
    if (cmd === 'git' && args[0] === 'for-each-ref') return integration.length ? integration.join('\n') + '\n' : ''
    throw new Error('unexpected ' + cmd + ' ' + args.join(' '))
  }
}

test('collectImplementable: surfaces an Accepted design on target, skips Active and in-flight', async () => {
  const exec = fakeWorld({
    designs: {
      'llp/0045-client-attach.design.md': '# LLP 45: Client attach\n\n**Type:** design\n**Status:** Accepted\n',
      'llp/0041-central.design.md': '# LLP 41: Central\n\n**Type:** design\n**Status:** Active\n',
      'llp/0050-other.design.md': '# LLP 50: Other\n\n**Type:** design\n**Status:** Accepted\n'
    },
    integration: ['origin/integration/other'] // 0050 ("other") is already being built
  })
  assert.deepEqual(await collectImplementable('/r', exec), [{ number: 45, slug: 'client-attach', title: 'Client attach' }])
})
