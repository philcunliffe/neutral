#!/usr/bin/env node
// @ts-check
// Outage sentinel — the container's deterministic last line of defense. Every
// other voice in the container (loops, watchdog, mayor) is a Claude session,
// so a fleet-wide failure — an API outage, a dead gateway attach, a revoked
// credential — silences the alarm together with the workers. This daemon
// contains no model call and no claude dependency: it reads transcript tails
// for the fleet's newest completed model turn, and when the whole fleet has
// been silent past the threshold it posts to Slack directly via
// chat.postMessage (the LLP 0040 outbound-direct path). It notifies only —
// healing stays with the watchdog. Runs in its own tmux session; the
// entrypoint supervisor respawns it when dead. All judgment-free: the pure
// classifier and state machine live in src/silence.js and are unit-tested
// offline; this file is the fs/tmux/network shell.
// @ref LLP 0057#sentinel [implements] — no model on the path
// @ref LLP 0057#notify-only [constrained-by] — sends no keys, kills nothing
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  newestUsageMs, classifySilence, incidentKey, sentinelStep,
  formatAlert, formatNag, formatRecovery
} from '../src/silence.js'

/** @import { SentinelIncident, SentinelProbes } from '../src/types.d.ts' */

const log = (/** @type {string} */ msg) => console.log(`[outage-sentinel] ${msg}`)

// Usage events are frequent in any live session, so the newest one is always
// near the end of its transcript — a bounded tail read keeps a 60 s poll cheap
// against multi-hundred-MB transcripts.
const TAIL_BYTES = 512 * 1024

/**
 * Sentinel configuration. Throws listing every missing var — a misconfigured
 * sentinel should die loudly and be seen by the supervisor, not limp.
 * @param {Record<string, string | undefined>} env
 */
export function configFromEnv(env) {
  const missing = ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'].filter(k => !env[k])
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`)
  return {
    botToken: /** @type {string} */ (env.SLACK_BOT_TOKEN),
    channel: /** @type {string} */ (env.SLACK_CHANNEL_ID),
    thresholdMin: Number(env.NEUTRAL_SENTINEL_SILENCE_MIN) || 60,
    pollSec: Number(env.NEUTRAL_SENTINEL_POLL_SEC) || 60,
    heartbeatUrl: env.NEUTRAL_HEARTBEAT_URL || null
  }
}

/**
 * The last TAIL_BYTES of a file, decoded as utf8 (a partial first line is
 * skipped by the classifier's per-line parse).
 * @param {string} path
 * @returns {string}
 */
function readTail(path) {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const len = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * The newest usage timestamp across every session transcript under
 * `~/.claude/projects`. Files are visited newest-mtime-first so the scan can
 * stop early: a file's last write is at or after its newest event, so once
 * mtime falls at or below the best usage timestamp found, no later file can
 * beat it. (mtime is only ever used to SKIP work, never as the liveness
 * signal — LLP 0034's incident.)
 * @param {string} projectsDir
 * @returns {number|null}
 */
export function fleetNewestUsageMs(projectsDir) {
  /** @type {{ path: string, mtimeMs: number }[]} */
  const files = []
  let dirs
  try { dirs = readdirSync(projectsDir) } catch { return null }
  for (const d of dirs) {
    let entries
    try { entries = readdirSync(join(projectsDir, d)) } catch { continue }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(projectsDir, d, f)
      try { files.push({ path: p, mtimeMs: statSync(p).mtimeMs }) } catch { /* raced away */ }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let best = null
  for (const f of files) {
    if (best !== null && f.mtimeMs <= best) break
    let t
    try { t = newestUsageMs(readTail(f.path)) } catch { continue }
    if (t !== null && (best === null || t > best)) best = t
  }
  return best
}

/**
 * One Slack Web API call; returns the parsed body, throws on `ok: false`.
 * @param {string} token
 * @param {string} method
 * @param {Record<string, unknown>} payload
 * @returns {Promise<any>}
 */
async function slack(token, method, payload) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  })
  const body = /** @type {any} */ (await res.json())
  if (!body.ok) throw new Error(`${method} failed: ${body.error ?? res.status}`)
  return body
}

/**
 * Dedupe read before posting a root: scan channel history for this incident's
 * key (Slack is the ground truth for what has been reported — no state file).
 * Covers a sentinel restarted mid-incident. Returns the existing root's ts, or
 * null.
 * @ref LLP 0057#notify-direct [implements] — the LLP 0042 history-scan dedupe
 * @param {{ botToken: string, channel: string }} cfg
 * @param {string} key
 * @param {number} sinceMs
 * @returns {Promise<string|null>}
 */
export async function findExistingRoot(cfg, key, sinceMs) {
  const body = await slack(cfg.botToken, 'conversations.history', {
    channel: cfg.channel,
    oldest: String(Math.floor(sinceMs / 1000) - 60),
    limit: 200
  })
  for (const m of body.messages ?? []) {
    if (typeof m.text === 'string' && m.text.includes(key)) return m.ts
  }
  return null
}

/**
 * Alert decoration, all best-effort: any HTTP response proves reachability
 * (an unauthenticated call to the API answers 401 — still proof the outage is
 * not on the network path). Null means the probe itself was unavailable.
 * @ref LLP 0057#notify-direct [implements] — probes decorate, never trigger
 * @param {string} home
 * @returns {Promise<SentinelProbes>}
 */
async function runProbes(home) {
  const touch = (/** @type {string} */ url) =>
    fetch(url, { signal: AbortSignal.timeout(10_000) }).then(() => true, () => false)
  /** @type {Promise<boolean|null>} */
  let gateway = Promise.resolve(null)
  try {
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
    const port = settings?._hypaware?.port
    if (port) gateway = touch(`http://127.0.0.1:${port}/`)
  } catch { /* no settings — gateway unknown */ }
  const sessions = new Promise(resolve => {
    execFile('tmux', ['list-sessions', '-F', '#S'], (err, stdout) =>
      resolve(err ? null : stdout.split('\n').filter(Boolean)))
  })
  const [api, gw, sess] = await Promise.all([touch('https://api.anthropic.com/'), gateway, sessions])
  return { api, gateway: gw, sessions: /** @type {string[]|null} */ (sess) }
}

/**
 * One pass: ping the external dead-man's switch, classify fleet silence, act.
 * @param {ReturnType<typeof configFromEnv>} cfg
 * @param {{ home: string, bootMs: number }} ctx
 * @param {SentinelIncident|null} incident
 * @returns {Promise<SentinelIncident|null>} the next incident state
 */
async function pass(cfg, ctx, incident) {
  // The external rung first (LLP 0057 §external-heartbeat): its ABSENCE is the
  // alert, so it must fire even — especially — when everything else is broken.
  if (cfg.heartbeatUrl) {
    await fetch(cfg.heartbeatUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => {})
  }

  const newestMs = fleetNewestUsageMs(join(ctx.home, '.claude', 'projects'))
  const nowMs = Date.now()
  const verdict = classifySilence({ newestMs, bootMs: ctx.bootMs, nowMs, thresholdMin: cfg.thresholdMin })
  const step = sentinelStep(incident, verdict, nowMs)

  if (step.action === 'none') return incident

  if (step.action === 'open' || step.action === 'reopen') {
    if (incident && step.action === 'reopen') {
      log(`silence rolled over (one turn completed at ${new Date(step.recoveredMs).toISOString()}) — closing old root`)
      await slack(cfg.botToken, 'chat.postMessage', {
        channel: cfg.channel, thread_ts: incident.rootTs, text: formatRecovery({ recoveredMs: step.recoveredMs })
      })
    }
    const key = incidentKey(step.sinceMs)
    const existing = await findExistingRoot(cfg, key, step.sinceMs)
    if (existing) {
      log(`incident already reported (root ts=${existing}) — adopting`)
      return { sinceMs: step.sinceMs, rootTs: existing, lastNagMs: nowMs }
    }
    const probes = await runProbes(ctx.home)
    const body = await slack(cfg.botToken, 'chat.postMessage', {
      channel: cfg.channel, text: formatAlert({ sinceMs: step.sinceMs, quietMin: verdict.quietMin, probes })
    })
    log(`ALERT posted — fleet silent since ${new Date(step.sinceMs).toISOString()}`)
    return { sinceMs: step.sinceMs, rootTs: body.ts, lastNagMs: nowMs }
  }

  if (step.action === 'nag' && incident) {
    await slack(cfg.botToken, 'chat.postMessage', {
      channel: cfg.channel, thread_ts: incident.rootTs, text: formatNag({ sinceMs: incident.sinceMs, nowMs })
    })
    log('nag posted — incident still open')
    return { ...incident, lastNagMs: nowMs }
  }

  if (step.action === 'recover' && incident) {
    await slack(cfg.botToken, 'chat.postMessage', {
      channel: cfg.channel, thread_ts: incident.rootTs, text: formatRecovery({ recoveredMs: step.recoveredMs })
    })
    log(`recovered — model turns completing again as of ${new Date(step.recoveredMs).toISOString()}`)
    return null
  }

  return incident
}

async function main() {
  const cfg = configFromEnv(process.env)
  const ctx = { home: homedir(), bootMs: Date.now() }
  log(`up — channel=${cfg.channel} threshold=${cfg.thresholdMin}min poll=${cfg.pollSec}s heartbeat=${cfg.heartbeatUrl ? 'on' : 'off'}`)
  /** @type {SentinelIncident|null} */
  let incident = null
  for (;;) {
    try {
      incident = await pass(cfg, ctx, incident)
    } catch (err) {
      // Never die on a pass error (a Slack 5xx, a transient fs race): a dead
      // sentinel during an outage is the exact failure this exists to end.
      log(`WARNING: pass failed: ${err}`)
    }
    await new Promise(r => setTimeout(r, cfg.pollSec * 1000))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(`[outage-sentinel] fatal: ${err}`); process.exit(1) })
}
