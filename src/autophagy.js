// @ts-check
// autophagy: which repo-hygiene idle initiative (if any) runs this tick? A PURE selector
// over the open-PR observation + closed-autophagy dispositions + config + the clock — so
// the orchestrator ACTS on the signal rather than re-deciding it, and is unit-tested
// offline like the other classifiers (idle.js, prhealth.js, issuefix.js).
// @ref LLP 0047#selection [implements] — cooldown-gated, least-recently-run selection
// @ref LLP 0036#eligibility [implements] — the per-member config + one-at-a-time gate
// @ref LLP 0002#principle [constrained-by] — eligibility is observed, never self-report

/** @import { NeutralConfig, MemberState, InitiativeSelection } from './types.d.ts' */

// Repo-hygiene autophagy branch namespace. prs.js admits autophagy/* into the own-PR
// ladder; one open autophagy PR (of ANY member) blocks the next initiative — LLP 0011's
// "don't open 40 dead-code PRs" backoff, made mechanical and GLOBAL (LLP 0047 §gate-global).
// @ref LLP 0036#initiative [implements] — the autophagy/ branch namespace
export const AUTOPHAGY_PREFIX = 'autophagy/'

// The repo-hygiene members, in fixed tiebreak order (LLP 0047 §rotation). Each owns a
// branch namespace `autophagy/<id>-*` and a config switch under `autophagy`. Adding a
// member is one row here plus its worker; the selection machinery is member-agnostic.
// @ref LLP 0047#rotation [implements] — the member registry the rotation ranks
/** @type {Array<{ id: string, configKey: 'codeCleanup' }>} */
export const AUTOPHAGY_MEMBERS = [
  { id: 'cleanup', configKey: 'codeCleanup' } // LLP 0036 — code cleanup
]

const HOUR_MS = 3600_000

/**
 * The disposition anchor for one member: its most-recent closed autophagy PR, with the
 * verdict that picks which cooldown applies — `mergedAt` ⇒ accepted, else `closedAt` ⇒
 * rejected (LLP 0047 §cooldown). null when the member has never run.
 * @param {string} id
 * @param {Array<{ headRefName: string, mergedAt: string|null, closedAt: string|null }>} disposed
 * @returns {{ at: number, merged: boolean } | null}
 */
function lastDisposition(id, disposed) {
  const prefix = `${AUTOPHAGY_PREFIX}${id}-`
  /** @type {{ at: number, merged: boolean } | null} */
  let best = null
  for (const p of disposed) {
    if (!p.headRefName.startsWith(prefix)) continue
    const at = Date.parse(p.mergedAt || p.closedAt || '')
    if (Number.isNaN(at)) continue
    if (!best || at > best.at) best = { at, merged: !!p.mergedAt }
  }
  return best
}

/**
 * Classify one member's eligibility from ground truth + the clock (LLP 0047): off in
 * config, inside its disposition cooldown, or no-op damped ⇒ ineligible. A member that
 * has never run is eligible (subject to the global gate) — a fresh member gets its turn.
 * @param {{ id: string, configKey: 'codeCleanup' }} member
 * @param {NeutralConfig} config
 * @param {Array<{ headRefName: string, mergedAt: string|null, closedAt: string|null }>} disposed
 * @param {number} now
 * @param {Set<string>} damped
 * @returns {MemberState}
 */
function memberState(member, config, disposed, now, damped) {
  const { id } = member
  if (!config.autophagy[member.configKey]) {
    return { id, eligible: false, cooldownRemaining: 0, lastDisposition: null, reason: `autophagy.${member.configKey} is false in .neutral/config.json` }
  }
  const last = lastDisposition(id, disposed)
  const at = last ? last.at : null
  if (last) {
    // @ref LLP 0047#cooldown [implements] — reject backs off longer than merge
    const hours = last.merged ? config.autophagy.cooldownAfterMergeHours : config.autophagy.cooldownAfterRejectHours
    const remaining = Math.max(0, last.at + hours * HOUR_MS - now)
    if (remaining > 0) {
      const kind = last.merged ? 'merge' : 'reject'
      return { id, eligible: false, cooldownRemaining: remaining, lastDisposition: at, reason: `in ${kind} cooldown — ${Math.ceil(remaining / HOUR_MS)}h left` }
    }
  }
  // @ref LLP 0047#noop-dampening [constrained-by] — the orchestrator's session hint
  if (damped.has(id)) {
    return { id, eligible: false, cooldownRemaining: 0, lastDisposition: at, reason: 'no-op damped — target HEAD unchanged since last empty scan' }
  }
  return { id, eligible: true, cooldownRemaining: 0, lastDisposition: at, reason: last ? 'past cooldown' : 'never run' }
}

/**
 * Select the idle-tick repo-hygiene initiative from ground truth (LLP 0047 §selection):
 * the least-recently-run member that is on, past its cooldown, and not no-op damped — or
 * null for a deliberately idle tick. An open autophagy PR of ANY member blocks the whole
 * family (§gate-global). Recycle preemption is decided upstream (LLP 0035/0013); this
 * ranks only repo-hygiene members and assumes the tick is already idle.
 * @param {object} obs
 * @param {Array<{ number: number, head: string }>} obs.openPRs   in-scope open PRs — the global one-at-a-time gate
 * @param {Array<{ headRefName: string, mergedAt: string|null, closedAt: string|null }>} obs.disposed  closed autophagy PRs
 * @param {NeutralConfig} obs.config
 * @param {number} obs.now  epoch ms
 * @param {Iterable<string>} [obs.damped]  member ids no-op damped at the current HEAD (orchestrator hint)
 * @returns {InitiativeSelection}
 */
export function selectInitiative({ openPRs, disposed, config, now, damped = [] }) {
  // @ref LLP 0047#gate-global [implements] — one open autophagy PR, any member, blocks all
  const openAutophagy = openPRs.find(p => p.head.startsWith(AUTOPHAGY_PREFIX))
  if (openAutophagy) {
    const reason = `pr#${openAutophagy.number} (${openAutophagy.head}) open — one autophagy PR at a time`
    const members = AUTOPHAGY_MEMBERS.map(m => {
      const last = lastDisposition(m.id, disposed)
      return { id: m.id, eligible: false, cooldownRemaining: 0, lastDisposition: last ? last.at : null, reason }
    })
    return { initiative: null, members }
  }
  const dampedSet = new Set(damped)
  const members = AUTOPHAGY_MEMBERS.map(m => memberState(m, config, disposed, now, dampedSet))
  return { initiative: leastRecentlyRun(members), members }
}

/**
 * Pick the least-recently-run eligible member (LLP 0047 §rotation): the oldest last
 * disposition wins; a never-run member (null) sorts oldest so a freshly-added member
 * takes its first turn ahead of veterans. Ties fall to input order — a stable pick, so
 * the fixed registry order is the tiebreak. null when no member is eligible (a
 * deliberately idle tick). Pure over the member breakdown, so the rotation is
 * unit-testable independent of the roster size.
 * @param {MemberState[]} members
 * @returns {string | null}
 */
export function leastRecentlyRun(members) {
  /** @type {{ id: string, key: number } | null} */
  let pick = null
  for (const m of members) {
    if (!m.eligible) continue
    const key = m.lastDisposition === null ? -Infinity : m.lastDisposition
    if (!pick || key < pick.key) pick = { id: m.id, key }
  }
  return pick ? pick.id : null
}
