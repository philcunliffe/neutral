#!/usr/bin/env node
// @ts-check
// Slack Socket Mode bridge — the container's inbound chat plumbing. Holds the
// Socket Mode WebSocket, drops everything except plain channel/thread messages
// from allowlisted users, frames each with provenance, and injects it into the
// mayor's tmux pane. Dumb by design: no model calls, no parsing beyond
// allowlist + framing — all judgment lives in the mayor. Runs in its own tmux
// session; the entrypoint supervisor respawns it when dead. Dependency-free
// container plumbing (Node 22 built-in WebSocket + fetch, tmux via
// child_process) — outside the deterministic core, but offline-testable: the
// pure functions below never shell out, and injection goes through an
// injectable Exec seam (LLP 0042 R4).
// @ref LLP 0040#socket-mode [implements] — outbound WebSocket only; no inbound ports

import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** @import { SlackMessageEvent, SocketEnvelope, BridgeConfig, Classified, Exec } from './types.d.ts' */

const log = (/** @type {string} */ msg) => console.log(`[slack-bridge] ${msg}`)

/**
 * Comma-separated `SLACK_ALLOWED_USER_IDS` → user-id list (trimmed, empties
 * dropped).
 * @param {string} raw
 * @returns {string[]}
 */
export function parseAllowlist(raw) {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * One pane message carrying the human's text verbatim plus provenance. `thread`
 * carries the root's ts so the mayor resolves which event a reply answers by
 * matching the root's key line, never by inferring from prose.
 * @ref LLP 0042#inbound-framing [implements]
 * @param {SlackMessageEvent} event
 * @returns {string}
 */
export function frameMessage(event) {
  return `[slack ${event.user} ts=${event.ts} thread=${event.thread_ts ?? 'none'}] ${event.text}`
}

/**
 * The bridge's whole inbound judgment: inject a plain message from an
 * allowlisted user in the mayor's channel; drop everything else with a reason.
 * Authorization is enforced here, deterministically — a non-allowlisted
 * message never reaches the model.
 * @ref LLP 0040#allowlist [implements] — dropped before injection
 * @ref LLP 0040#bridge-dumb [constrained-by] — parses nothing beyond this
 * @param {SocketEnvelope} envelope
 * @param {BridgeConfig} cfg
 * @returns {Classified}
 */
export function classifyEnvelope(envelope, cfg) {
  const event = envelope.payload?.event
  if (!event || event.type !== 'message') return { kind: 'drop', reason: 'not-a-message' }
  // Subtypes are edits, joins, file shares, bot posts — none is a plain human
  // message; the human can restate in a fresh message.
  if (event.subtype) return { kind: 'drop', reason: `subtype:${event.subtype}` }
  if (event.bot_id) return { kind: 'drop', reason: 'bot' }
  if (event.channel !== cfg.channel) return { kind: 'drop', reason: 'other-channel' }
  if (!event.user || !cfg.allowlist.includes(event.user)) return { kind: 'drop', reason: 'not-allowlisted' }
  if (!event.text) return { kind: 'drop', reason: 'empty' }
  return { kind: 'inject', framed: frameMessage(event) }
}

/**
 * Whether the framed text still sits in the pane's input box (a line with the
 * `❯` prompt followed by the frame's head). Pure, so the submission check is
 * unit-testable against captured pane text.
 * @param {string} pane
 * @param {string} framed
 * @returns {boolean}
 */
export function pendingInInput(pane, framed) {
  const probe = framed.slice(0, 16)
  return pane.split('\n').some(line => {
    const i = line.indexOf('❯')
    return i !== -1 && line.slice(i).includes(probe)
  })
}

/**
 * Redelivery guard: Slack re-sends an envelope it thinks went unacked, and the
 * mayor must not receive the same message twice. In-memory only — a bridge
 * restart forgets, and Slack's own retry window is short.
 * @param {number} [cap]
 * @returns {(id: string | undefined) => boolean} true when `id` was already seen
 */
export function makeDeduper(cap = 1000) {
  /** @type {Set<string>} */
  const seen = new Set()
  return id => {
    if (!id) return false
    if (seen.has(id)) return true
    seen.add(id)
    if (seen.size > cap) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }
    return false
  }
}

/**
 * Inject one framed message into the mayor's pane with the LLP 0034 send-keys
 * discipline: `C-u` first (clear any harness prefill so the frame cannot
 * concatenate with it), paste the text as one bracketed-paste block (embedded
 * newlines must not submit early), Enter, then verify submission — the text
 * must leave the input box; one extra Enter if the first was swallowed as part
 * of the paste. Never presses Enter on text the bridge did not type.
 * @ref LLP 0042#inbound-framing [implements] — the injection discipline
 * @param {string} framed
 * @param {string} session
 * @param {Exec} exec
 * @param {(ms: number) => Promise<void>} [sleep]
 * @returns {Promise<boolean>} true when submission was verified
 */
export async function injectIntoPane(framed, session, exec, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const target = ['-t', `=${session}`]
  await exec(['send-keys', ...target, 'C-u'])
  await exec(['load-buffer', '-b', 'neutral-slack', '-'], framed)
  await exec(['paste-buffer', '-p', '-d', '-b', 'neutral-slack', ...target])
  await exec(['send-keys', ...target, 'Enter'])
  for (let tries = 0; tries < 10; tries++) {
    await sleep(3000)
    const pane = await exec(['capture-pane', '-p', ...target])
    if (!pendingInInput(pane, framed)) return true
    if (tries === 1) await exec(['send-keys', ...target, 'Enter'])
  }
  return false
}

/**
 * Bridge configuration from the environment. Throws (listing every missing
 * var) rather than limping — a misconfigured bridge should die loudly and be
 * seen by the supervisor.
 * @param {Record<string, string | undefined>} env
 * @returns {BridgeConfig}
 */
export function configFromEnv(env) {
  const missing = ['SLACK_APP_TOKEN', 'SLACK_CHANNEL_ID', 'SLACK_ALLOWED_USER_IDS'].filter(k => !env[k])
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`)
  return {
    appToken: /** @type {string} */ (env.SLACK_APP_TOKEN),
    channel: /** @type {string} */ (env.SLACK_CHANNEL_ID),
    allowlist: parseAllowlist(/** @type {string} */ (env.SLACK_ALLOWED_USER_IDS)),
    session: env.NEUTRAL_MAYOR_SESSION || 'neutral-mayor'
  }
}

/** The real tmux runner behind the Exec seam. @type {Exec} */
export const tmuxExec = (args, input) => new Promise((resolve, reject) => {
  const child = execFile('tmux', args, (err, stdout) => err ? reject(err) : resolve(stdout))
  if (input !== undefined) child.stdin?.end(input)
})

/**
 * One `apps.connections.open` call → the WebSocket URL for this connection.
 * @param {string} appToken
 * @returns {Promise<string>}
 */
async function openSocketUrl(appToken) {
  const res = await fetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: { authorization: `Bearer ${appToken}` }
  })
  const body = /** @type {{ ok?: boolean, error?: string, url?: string }} */ (await res.json())
  if (!body.ok || !body.url) throw new Error(`apps.connections.open failed: ${body.error ?? 'no url'}`)
  return body.url
}

/**
 * One envelope off the socket. Ack immediately (Slack redelivers unacked
 * envelopes), dedupe, classify, inject.
 * @param {string} raw
 * @param {{ send: (data: string) => void, close: () => void }} ws
 * @param {BridgeConfig} cfg
 * @param {{ seen: (id: string | undefined) => boolean, inject: (framed: string) => Promise<boolean>, onHello: () => void }} deps
 */
async function handleMessage(raw, ws, cfg, deps) {
  /** @type {SocketEnvelope} */
  let envelope
  try { envelope = JSON.parse(raw) } catch { return log('drop: unparseable frame') }
  if (envelope.type === 'hello') { deps.onHello(); return log('hello — connected') }
  if (envelope.type === 'disconnect') {
    log(`disconnect requested (${envelope.reason ?? 'unstated'}) — reconnecting`)
    return ws.close()
  }
  if (envelope.type !== 'events_api') return
  if (envelope.envelope_id) ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
  if (deps.seen(envelope.payload?.event_id)) return log('drop: redelivery')
  const verdict = classifyEnvelope(envelope, cfg)
  const event = envelope.payload?.event
  if (verdict.kind === 'drop') return log(`drop: ${verdict.reason} user=${event?.user ?? '?'} ts=${event?.ts ?? '?'}`)
  const ok = await deps.inject(verdict.framed)
  log(`${ok ? 'injected' : 'WARNING: injection unverified'} user=${event?.user} ts=${event?.ts}`)
}

/**
 * One socket lifetime: connect, handle frames until the socket closes, resolve
 * with the close reason. The caller loops and applies backoff.
 * @param {BridgeConfig} cfg
 * @param {{ seen: (id: string | undefined) => boolean, inject: (framed: string) => Promise<boolean>, onHello: () => void }} deps
 * @returns {Promise<string>}
 */
async function runSocket(cfg, deps) {
  const url = await openSocketUrl(cfg.appToken)
  const ws = new WebSocket(url)
  return new Promise(resolve => {
    ws.addEventListener('message', ev => { void handleMessage(String(ev.data), ws, cfg, deps) })
    ws.addEventListener('close', ev => resolve(`close code=${ev.code}`))
    ws.addEventListener('error', () => {})
  })
}

async function main() {
  const cfg = configFromEnv(process.env)
  log(`up — channel=${cfg.channel} session=${cfg.session} allowlist=${cfg.allowlist.length} user(s)`)
  const seen = makeDeduper()
  // Injections are serialized through a promise chain: two rapid messages must
  // not interleave their C-u/paste/Enter sequences in the same pane.
  let queue = Promise.resolve()
  const inject = (/** @type {string} */ framed) => {
    const turn = queue.then(() => injectIntoPane(framed, cfg.session, tmuxExec))
      .catch(err => { log(`WARNING: tmux injection failed: ${err}`); return false })
    queue = turn.then(() => undefined)
    return turn
  }
  let backoff = 1000
  for (;;) {
    try {
      const why = await runSocket(cfg, { seen, inject, onHello: () => { backoff = 1000 } })
      log(`socket ended (${why}) — reconnecting in ${backoff}ms`)
    } catch (err) {
      log(`WARNING: connect failed (${err}) — retrying in ${backoff}ms`)
    }
    await new Promise(r => setTimeout(r, backoff))
    backoff = Math.min(backoff * 2, 60_000)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(`[slack-bridge] fatal: ${err}`); process.exit(1) })
}
