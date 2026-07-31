// @ts-check
// Offline tests for the outage sentinel's deterministic surface: the
// newest-usage read, the silence classifier with its boot grace, the incident
// state machine, and the message/key formats — no network, no tmux, no fs.
// @ref LLP 0057#fleet-silence [tests]
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  newestUsageMs, classifySilence, incidentKey, sentinelStep,
  formatAlert, formatNag, formatRecovery
} from '../src/silence.js'

/** @import { SilenceVerdict, SentinelIncident } from '../src/types.d.ts' */

const T0 = Date.parse('2026-07-31T12:00:00.000Z')
const MIN = 60_000

/**
 * One transcript line. Usage-carrying lines mimic the harness's assistant
 * records (usage under `message`).
 * @param {string} iso
 * @param {boolean} withUsage
 */
function line(iso, withUsage) {
  return JSON.stringify(withUsage
    ? { type: 'assistant', timestamp: iso, message: { usage: { input_tokens: 10 } } }
    : { type: 'system', timestamp: iso })
}

test('newestUsageMs: picks the newest usage record, not the newest record', () => {
  const text = [
    line('2026-07-31T10:00:00.000Z', true),
    line('2026-07-31T10:30:00.000Z', true),
    line('2026-07-31T11:59:00.000Z', false) // a respawn's session-start record
  ].join('\n')
  assert.equal(newestUsageMs(text), Date.parse('2026-07-31T10:30:00.000Z'))
})

test('newestUsageMs: no usage anywhere → null (the outage signature)', () => {
  assert.equal(newestUsageMs([line('2026-07-31T11:59:00.000Z', false)].join('\n')), null)
  assert.equal(newestUsageMs(''), null)
})

test('newestUsageMs: garbled partial tail line is skipped', () => {
  const text = '"timestamp":"2026-07-31T11:00:00.000Z","message":{"usage":{}}}\n' + line('2026-07-31T10:00:00.000Z', true)
  assert.equal(newestUsageMs(text), Date.parse('2026-07-31T10:00:00.000Z'))
})

test('classifySilence: recent usage → not silent', () => {
  const v = classifySilence({ newestMs: T0 - 20 * MIN, bootMs: T0 - 600 * MIN, nowMs: T0, thresholdMin: 60 })
  assert.equal(v.silent, false)
  assert.equal(v.sinceMs, T0 - 20 * MIN)
})

test('classifySilence: usage past the threshold → silent since the last turn', () => {
  const v = classifySilence({ newestMs: T0 - 90 * MIN, bootMs: T0 - 600 * MIN, nowMs: T0, thresholdMin: 60 })
  assert.equal(v.silent, true)
  assert.equal(v.sinceMs, T0 - 90 * MIN)
  assert.equal(Math.round(v.quietMin), 90)
})

test('classifySilence: boot grace — no usage ever, young container stays quiet', () => {
  const v = classifySilence({ newestMs: null, bootMs: T0 - 10 * MIN, nowMs: T0, thresholdMin: 60 })
  assert.equal(v.silent, false)
  assert.equal(v.sinceMs, T0 - 10 * MIN)
})

test('classifySilence: born into an outage — fires one threshold after boot', () => {
  const v = classifySilence({ newestMs: null, bootMs: T0 - 61 * MIN, nowMs: T0, thresholdMin: 60 })
  assert.equal(v.silent, true)
  assert.equal(v.sinceMs, T0 - 61 * MIN)
})

test('classifySilence: stale usage from before boot never predates the boot clock', () => {
  const v = classifySilence({ newestMs: T0 - 600 * MIN, bootMs: T0 - 30 * MIN, nowMs: T0, thresholdMin: 60 })
  assert.equal(v.silent, false)
  assert.equal(v.sinceMs, T0 - 30 * MIN)
})

/** @type {(silent: boolean, sinceMs: number) => SilenceVerdict} */
const verdict = (silent, sinceMs) => ({ silent, sinceMs, quietMin: (T0 - sinceMs) / MIN })
/** @type {SentinelIncident} */
const incident = { sinceMs: T0 - 90 * MIN, rootTs: '1753.100', lastNagMs: T0 - 30 * MIN }

test('sentinelStep: healthy, no incident → none', () => {
  assert.deepEqual(sentinelStep(null, verdict(false, T0 - 5 * MIN), T0), { action: 'none' })
})

test('sentinelStep: silence crosses the threshold → open', () => {
  assert.deepEqual(sentinelStep(null, verdict(true, T0 - 90 * MIN), T0), { action: 'open', sinceMs: T0 - 90 * MIN })
})

test('sentinelStep: ongoing incident inside the nag window → none', () => {
  assert.deepEqual(sentinelStep(incident, verdict(true, incident.sinceMs), T0), { action: 'none' })
})

test('sentinelStep: ongoing incident past the nag window → nag', () => {
  const stale = { ...incident, lastNagMs: T0 - 7 * 60 * MIN }
  assert.deepEqual(sentinelStep(stale, verdict(true, incident.sinceMs), T0), { action: 'nag' })
})

test('sentinelStep: life resumed → recover at the new usage timestamp', () => {
  assert.deepEqual(sentinelStep(incident, verdict(false, T0 - 2 * MIN), T0),
    { action: 'recover', recoveredMs: T0 - 2 * MIN })
})

test('sentinelStep: one turn flickered mid-outage, silence resumed → reopen', () => {
  const flicker = T0 - 70 * MIN // newer than the incident's since, still past threshold
  assert.deepEqual(sentinelStep(incident, verdict(true, flicker), T0),
    { action: 'reopen', sinceMs: flicker, recoveredMs: flicker })
})

test('incidentKey: silence-start is the incident identity — stable and machine-findable', () => {
  assert.equal(incidentKey(T0 - 90 * MIN), '[neutral fleet silent-since@2026-07-31T10:30:00.000Z]')
  assert.equal(incidentKey(T0 - 90 * MIN), incidentKey(T0 - 90 * MIN))
})

test('formatAlert: key on the first line, probes decorate', () => {
  const text = formatAlert({
    sinceMs: T0 - 90 * MIN, quietMin: 90,
    probes: { api: false, gateway: true, sessions: ['neutral-hypaware', 'neutral-watchdog'] }
  })
  assert.ok(text.startsWith('[neutral fleet silent-since@2026-07-31T10:30:00.000Z]\n'))
  assert.match(text, /Fleet silent for 90 min/)
  assert.match(text, /api\.anthropic\.com: UNREACHABLE/)
  assert.match(text, /gateway: reachable/)
  assert.match(text, /neutral-hypaware, neutral-watchdog/)
})

test('formatAlert: failed probes read as unknown, never as a claim', () => {
  const text = formatAlert({ sinceMs: T0, quietMin: 61, probes: { api: null, gateway: null, sessions: null } })
  assert.match(text, /api\.anthropic\.com: unknown/)
  assert.match(text, /gateway: unknown/)
  assert.match(text, /tmux sessions: unknown/)
})

test('formatNag / formatRecovery: carry the facts, recovery carries its key', () => {
  assert.match(formatNag({ sinceMs: T0 - 90 * MIN, nowMs: T0 }), /1\.5 h without a completed model turn/)
  assert.ok(formatRecovery({ recoveredMs: T0 }).startsWith('[neutral fleet recovered@2026-07-31T12:00:00.000Z]'))
})
