// @ts-check
// Fleet-silence classifier for the outage sentinel: when did the fleet last
// complete a model turn, is that long enough ago to count as an outage, and
// what should the sentinel do about it this pass. A *sign of life* is a
// `usage`-carrying transcript record — the API's own account of a completed
// turn — because a fleet erroring on every request still writes session-start
// records as the supervisor respawns it, but produces no usage. Everything
// here is a pure function of transcript text and clock values, unit-tested
// offline; the daemon (docker/outage-sentinel.js) owns all fs/tmux/network.
// @ref LLP 0057#fleet-silence [implements] — usage events, never mtime, never mere records
// @ref LLP 0002#principle [constrained-by] — silence is re-derived from transcripts, never a ledger
import { usageOf } from './context.js'

/** @import { SilenceVerdict, SentinelIncident, SentinelAction, SentinelProbes } from './types.d.ts' */

/**
 * The newest usage-carrying record's timestamp in one transcript, in epoch ms.
 * Null when the transcript holds no completed turn (a session that never got
 * an API response — exactly the outage signature).
 * @param {string} text  JSONL transcript text (or a tail of it)
 * @returns {number|null}
 */
export function newestUsageMs(text) {
  let newest = null
  for (const line of String(text || '').split('\n')) {
    const s = line.trim()
    if (!s) continue
    let rec
    try { rec = JSON.parse(s) } catch { continue } // partial/garbled tail line
    if (!usageOf(rec)) continue
    const t = Date.parse(rec.timestamp)
    if (!Number.isNaN(t) && (newest === null || t > newest)) newest = t
  }
  return newest
}

/**
 * Fleet-silence verdict. The clock starts at boot: a container born into an
 * outage (or born misattached) has no usage events at all, and must still fire
 * one threshold after boot — so the last sign of life is
 * max(newest usage, boot), never earlier.
 * @ref LLP 0057#fleet-silence [implements] — the threshold and the boot grace
 * @param {{ newestMs: number|null, bootMs: number, nowMs: number, thresholdMin: number }} args
 * @returns {SilenceVerdict}
 */
export function classifySilence({ newestMs, bootMs, nowMs, thresholdMin }) {
  const sinceMs = Math.max(newestMs ?? 0, bootMs)
  const quietMin = Math.max(0, (nowMs - sinceMs) / 60_000)
  return { silent: quietMin > thresholdMin, sinceMs, quietMin }
}

/**
 * The machine-findable incident key (LLP 0042 key discipline): silence-start
 * timestamp = incident identity, so the same ongoing incident always produces
 * the same key and dedupes against channel history.
 * @ref LLP 0057#notify-direct [implements] — key format
 * @param {number} sinceMs
 * @returns {string}
 */
export function incidentKey(sinceMs) {
  return `[neutral fleet silent-since@${new Date(sinceMs).toISOString()}]`
}

/**
 * One sentinel pass reduced to a single action. Pure, so the incident state
 * machine is offline-testable: open a new incident, nag an ongoing one every
 * `nagMs`, recover a closed one, or roll over when life flickered once and
 * silence resumed (a new since = a new incident).
 * @ref LLP 0057#notify-direct [implements] — once per incident, 6 h nags, recovery
 * @param {SentinelIncident|null} incident
 * @param {SilenceVerdict} verdict
 * @param {number} nowMs
 * @param {number} [nagMs]
 * @returns {SentinelAction}
 */
export function sentinelStep(incident, verdict, nowMs, nagMs = 6 * 3600_000) {
  if (!incident) {
    return verdict.silent ? { action: 'open', sinceMs: verdict.sinceMs } : { action: 'none' }
  }
  // Healthy again — verdict.sinceMs is now the newest usage, i.e. when life resumed.
  if (!verdict.silent) return { action: 'recover', recoveredMs: verdict.sinceMs }
  // Still silent but from a NEWER last-sign-of-life: one turn completed during
  // the incident and silence resumed — close the old root, open a fresh one.
  if (verdict.sinceMs !== incident.sinceMs) return { action: 'reopen', sinceMs: verdict.sinceMs, recoveredMs: verdict.sinceMs }
  if (nowMs - incident.lastNagMs >= nagMs) return { action: 'nag' }
  return { action: 'none' }
}

/**
 * @param {boolean|null} probe
 * @returns {string}
 */
const reach = probe => probe === null ? 'unknown' : probe ? 'reachable' : 'UNREACHABLE'

/**
 * The alert root: key first (machine-findable), then the facts a deterministic
 * process can vouch for. Probes decorate; they never triggered this.
 * @ref LLP 0057#notify-direct [implements] — fixed template, probes as decoration
 * @param {{ sinceMs: number, quietMin: number, probes: SentinelProbes }} args
 * @returns {string}
 */
export function formatAlert({ sinceMs, quietMin, probes }) {
  const sessions = probes.sessions === null ? 'unknown' : (probes.sessions.join(', ') || 'none')
  return [
    incidentKey(sinceMs),
    `:rotating_light: *Fleet silent for ${Math.round(quietMin)} min* — no session has completed a model turn since ${new Date(sinceMs).toISOString()}.`,
    `api.anthropic.com: ${reach(probes.api)} · gateway: ${reach(probes.gateway)} · tmux sessions: ${sessions}`,
    'The loops, watchdog, and mayor are all LLM sessions — assume nothing can self-report until this recovers.'
  ].join('\n')
}

/**
 * Thread nag while an incident stays open.
 * @param {{ sinceMs: number, nowMs: number }} args
 * @returns {string}
 */
export function formatNag({ sinceMs, nowMs }) {
  const h = ((nowMs - sinceMs) / 3600_000).toFixed(1)
  return `still silent — ${h} h without a completed model turn`
}

/**
 * Recovery reply under the incident root; its own key closes the incident in
 * channel history.
 * @param {{ recoveredMs: number }} args
 * @returns {string}
 */
export function formatRecovery({ recoveredMs }) {
  return `[neutral fleet recovered@${new Date(recoveredMs).toISOString()}] :white_check_mark: model turns are completing again`
}
