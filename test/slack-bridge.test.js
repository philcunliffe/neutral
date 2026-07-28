// @ts-check
// Offline tests for the bridge's deterministic surface: allowlist, framing,
// classification, submission check, and the injection sequence against a fake
// tmux target — no network, no tmux server.
// @ref LLP 0042#inbound-framing [tests]
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAllowlist, frameMessage, classifyEnvelope, pendingInInput,
  makeDeduper, injectIntoPane, configFromEnv
} from '../docker/slack-bridge.js'

/** @import { SlackMessageEvent, SocketEnvelope, BridgeConfig, Exec } from '../docker/types.d.ts' */

/** @type {BridgeConfig} */
const cfg = { appToken: 'xapp-1', channel: 'C0CHAN', allowlist: ['U0PHIL'], session: 'neutral-mayor' }

/**
 * An events_api envelope around a message event, overridable per test.
 * @param {Partial<SlackMessageEvent>} over
 * @returns {SocketEnvelope}
 */
function envelope(over = {}) {
  return {
    envelope_id: 'env-1',
    type: 'events_api',
    payload: {
      type: 'event_callback',
      event_id: 'Ev1',
      event: { type: 'message', user: 'U0PHIL', text: 'hello mayor', ts: '1753.100', channel: 'C0CHAN', ...over }
    }
  }
}

test('parseAllowlist: trims, drops empties', () => {
  assert.deepEqual(parseAllowlist('U1, U2 ,,U3'), ['U1', 'U2', 'U3'])
  assert.deepEqual(parseAllowlist(''), [])
})

test('frameMessage: channel message frames with thread=none, text verbatim', () => {
  assert.equal(
    frameMessage({ type: 'message', user: 'U0PHIL', ts: '1753.100', text: 'status? [urgent]' }),
    '[slack U0PHIL ts=1753.100 thread=none] status? [urgent]'
  )
})

test('frameMessage: thread reply carries the root ts', () => {
  assert.equal(
    frameMessage({ type: 'message', user: 'U0PHIL', ts: '1753.200', thread_ts: '1753.100', text: 'merge it' }),
    '[slack U0PHIL ts=1753.200 thread=1753.100] merge it'
  )
})

test('classifyEnvelope: allowlisted plain message injects framed', () => {
  const v = classifyEnvelope(envelope(), cfg)
  assert.equal(v.kind, 'inject')
  assert.ok(v.kind === 'inject' && v.framed.startsWith('[slack U0PHIL ts=1753.100 thread=none] '))
})

// The security property: authorization is enforced at the bridge — a message
// from a user outside SLACK_ALLOWED_USER_IDS never reaches the mayor.
// @ref LLP 0040#allowlist [tests]
test('classifyEnvelope: non-allowlisted user drops before injection', () => {
  assert.deepEqual(classifyEnvelope(envelope({ user: 'U9EVIL' }), cfg), { kind: 'drop', reason: 'not-allowlisted' })
  assert.deepEqual(classifyEnvelope(envelope({ user: undefined }), cfg), { kind: 'drop', reason: 'not-allowlisted' })
})

test('classifyEnvelope: drops non-messages, subtypes, bots, other channels, empty text', () => {
  const noEvent = /** @type {SocketEnvelope} */ ({ type: 'events_api', payload: { type: 'event_callback' } })
  assert.deepEqual(classifyEnvelope(noEvent, cfg), { kind: 'drop', reason: 'not-a-message' })
  assert.deepEqual(classifyEnvelope(envelope({ type: 'reaction_added' }), cfg), { kind: 'drop', reason: 'not-a-message' })
  assert.deepEqual(classifyEnvelope(envelope({ subtype: 'message_changed' }), cfg), { kind: 'drop', reason: 'subtype:message_changed' })
  assert.deepEqual(classifyEnvelope(envelope({ bot_id: 'B1' }), cfg), { kind: 'drop', reason: 'bot' })
  assert.deepEqual(classifyEnvelope(envelope({ channel: 'C9OTHER' }), cfg), { kind: 'drop', reason: 'other-channel' })
  assert.deepEqual(classifyEnvelope(envelope({ text: '' }), cfg), { kind: 'drop', reason: 'empty' })
})

test('makeDeduper: first sight passes, redelivery drops, missing id always passes', () => {
  const seen = makeDeduper()
  assert.equal(seen('Ev1'), false)
  assert.equal(seen('Ev1'), true)
  assert.equal(seen('Ev2'), false)
  assert.equal(seen(undefined), false)
  assert.equal(seen(undefined), false)
})

test('pendingInInput: text at the ❯ prompt is pending; submitted text is not', () => {
  const framed = '[slack U0PHIL ts=1753.100 thread=none] hello mayor'
  assert.equal(pendingInInput(`│ some transcript\n│ ❯ ${framed}\n│`, framed), true)
  // After submission the text appears in the conversation body, not at the prompt.
  assert.equal(pendingInInput(`> ${framed}\n· thinking…\n│ ❯ \n`, framed), false)
  assert.equal(pendingInInput('', framed), false)
})

/**
 * Fake tmux target: records every call; capture-pane returns panes from a
 * script (last one repeats).
 * @param {string[]} panes
 */
function fakeTmux(panes) {
  /** @type {Array<{ args: string[], input?: string }>} */
  const calls = []
  /** @type {Exec} */
  const exec = (args, input) => {
    calls.push({ args, input })
    if (args[0] === 'capture-pane') return Promise.resolve(panes.length > 1 ? /** @type {string} */ (panes.shift()) : panes[0])
    return Promise.resolve('')
  }
  return { calls, exec }
}

const instant = () => Promise.resolve()

test('injectIntoPane: C-u, bracketed paste of the exact text, Enter, verified submission', async () => {
  const framed = '[slack U0PHIL ts=1753.100 thread=none] hello mayor'
  const { calls, exec } = fakeTmux(['❯ \n'])
  assert.equal(await injectIntoPane(framed, 'neutral-mayor', exec, instant), true)
  const kinds = calls.map(c => c.args[0])
  assert.deepEqual(kinds, ['send-keys', 'load-buffer', 'paste-buffer', 'send-keys', 'capture-pane'])
  assert.ok(calls[0].args.includes('C-u'), 'clears the input line first')
  assert.equal(calls[1].input, framed, 'pastes the framed text verbatim')
  assert.ok(calls[2].args.includes('-p'), 'bracketed paste so newlines cannot submit early')
  assert.ok(calls[3].args.includes('Enter'))
  assert.ok(calls[0].args.includes('=neutral-mayor'), 'exact-match session target')
})

test('injectIntoPane: swallowed Enter is retried once, then verifies', async () => {
  const framed = '[slack U0PHIL ts=1753.100 thread=none] hello mayor'
  const pending = `❯ ${framed}\n`
  const { calls, exec } = fakeTmux([pending, pending, '❯ \n'])
  assert.equal(await injectIntoPane(framed, 'neutral-mayor', exec, instant), true)
  const enters = calls.filter(c => c.args[0] === 'send-keys' && c.args.includes('Enter'))
  assert.equal(enters.length, 2, 'one initial Enter plus one retry')
})

test('injectIntoPane: never-submitting pane gives up false after bounded tries', async () => {
  const framed = '[slack U0PHIL ts=1753.100 thread=none] hello mayor'
  const { calls, exec } = fakeTmux([`❯ ${framed}\n`])
  assert.equal(await injectIntoPane(framed, 'neutral-mayor', exec, instant), false)
  assert.equal(calls.filter(c => c.args[0] === 'capture-pane').length, 10, 'bounded verification, no infinite loop')
})

test('configFromEnv: builds config, defaults the session name', () => {
  const env = { SLACK_APP_TOKEN: 'xapp-1', SLACK_CHANNEL_ID: 'C0CHAN', SLACK_ALLOWED_USER_IDS: 'U0PHIL,U1OTHER' }
  assert.deepEqual(configFromEnv(env), { appToken: 'xapp-1', channel: 'C0CHAN', allowlist: ['U0PHIL', 'U1OTHER'], session: 'neutral-mayor' })
  assert.equal(configFromEnv({ ...env, NEUTRAL_MAYOR_SESSION: 'mayor2' }).session, 'mayor2')
})

test('configFromEnv: lists every missing var', () => {
  assert.throws(() => configFromEnv({ SLACK_APP_TOKEN: 'xapp-1' }), /SLACK_CHANNEL_ID, SLACK_ALLOWED_USER_IDS/)
})
