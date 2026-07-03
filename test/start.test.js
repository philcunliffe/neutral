// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmuxStartArgv, startCommand, sessionName, LOOP_SHELL_COMMAND } from '../src/commands/start.js'

test('tmuxStartArgv: idempotent attach-or-create, detached when nested', () => {
  assert.deepEqual(tmuxStartArgv({ session: 'neutral-x' }), ['new-session', '-A', '-s', 'neutral-x', LOOP_SHELL_COMMAND])
  assert.deepEqual(tmuxStartArgv({ session: 'neutral-x', nested: true }), ['new-session', '-d', '-A', '-s', 'neutral-x', LOOP_SHELL_COMMAND])
  // the loop command runs via sh -c, with the orchestrator pinned to the 1M-context
  // Opus 4.8 (LLP 0020); the model token is single-quoted so sh doesn't glob `[1m]`
  assert.equal(LOOP_SHELL_COMMAND, "claude --model 'claude-opus-4-8[1m]' '/loop /neutral-reconcile'")
})

test('sessionName: per-repo `neutral-<folder>`, sanitized, with a bare fallback (LLP 0014)', () => {
  assert.equal(sessionName('/Users/phil/workspace/hypaware'), 'neutral-hypaware')
  assert.equal(sessionName('/Users/phil/workspace/neutral'), 'neutral-neutral')
  assert.equal(sessionName('/srv/my.app:2'), 'neutral-my-app-2')  // tmux-unsafe chars collapse to `-`
  assert.equal(sessionName('/'), 'neutral')                       // empty folder → bare prefix
  assert.equal(sessionName(''), 'neutral')
})

test('startCommand: tmux missing → fallback message, exit 1, never spawns', async () => {
  let spawned = false
  const code = await startCommand('/r', [], {
    exec: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
    spawn: () => { spawned = true; return { status: 0 } },
    env: {}
  })
  assert.equal(code, 1)
  assert.equal(spawned, false)
})

test('startCommand: plain terminal → hands argv to an interactive spawn, returns its status', async () => {
  /** @type {string[]|null} */
  let got = null
  const code = await startCommand('/repos/hypaware', [], {
    exec: async () => '',                       // tmux -V ok
    spawn: (_cmd, a) => { got = a; return { status: 0 } },
    env: {}                                      // not nested
  })
  assert.equal(code, 0)
  assert.deepEqual(got, ['new-session', '-A', '-s', 'neutral-hypaware', LOOP_SHELL_COMMAND])
})

test('startCommand: inside tmux → ensures a detached session, never attaches interactively', async () => {
  /** @type {string[]|null} */
  let execArgv = null
  let spawned = false
  const code = await startCommand('/repos/hypaware', [], {
    exec: async (_cmd, a) => { if (a[0] === 'new-session') execArgv = a; return '' },
    spawn: () => { spawned = true; return { status: 0 } },
    env: { TMUX: '/tmp/tmux-501/default,123,0' }  // already inside tmux
  })
  assert.equal(code, 0)
  assert.equal(spawned, false)
  assert.deepEqual(execArgv, ['new-session', '-d', '-A', '-s', 'neutral-hypaware', LOOP_SHELL_COMMAND])
})
