// @ts-check
// Per-repo configuration, so neutral fits a project's layout instead of assuming
// its own. Loaded from `.neutral/config.json`, merged over the defaults. Missing
// file → defaults. @ref LLP 0007#configuration
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** @import { NeutralConfig } from './types.d.ts' */

// Maintenance-family constants (LLP 0008/0009). The labels are the authorization
// gate: neutral acts on an artifact it did not mint only when a human delegated it.
// @ref LLP 0009#the-authorization-gate [implements]
export const FIX_LABEL = 'neutral:fix'      // a human delegates an issue for a fix attempt
export const STUCK_LABEL = 'neutral:stuck'  // neutral sets this when it cannot complete one
// Foreign-PR adoption labels (LLP 0025). `neutral:adopt` is a maintainer's authorization to
// review+heal a PR neutral did NOT author — the maintenance counterpart to `neutral:fix` on an
// issue (LLP 0024). `neutral:changes-requested` is the verdict neutral SETS in place of the
// ready-hold/merge it uses on its own PRs: readying or merging a contributor's PR is the
// maintainer's call (LLP 0000 §Autonomy). `neutral:approved` is dual-purpose: on an adopted
// PR it is that terminal verdict, and on an OWN PR it marks the reviewed-clean terminal,
// synced head-accurately by the skill to each decision's `approved` field (LLP 0030).
// @ref LLP 0025#trigger-and-authorization [implements] — the adopt trigger + verdict labels
// @ref LLP 0030 [implements] — neutral:approved also marks an own PR's reviewed-clean terminal
export const ADOPT_LABEL = 'neutral:adopt'
// `neutral:review` is the NARROWER grant (LLP 0032): review-only delegation. Same
// trigger mechanics as `neutral:adopt`, but neutral never pushes to the branch — it
// forces LLP 0025's review-only mode regardless of push access. When both labels are
// present the narrower grant wins: a delegation must never widen implicitly.
// @ref LLP 0032 [implements] — the review-only delegation label
export const REVIEW_LABEL = 'neutral:review'
export const APPROVED_LABEL = 'neutral:approved'
export const CHANGES_REQUESTED_LABEL = 'neutral:changes-requested'
// `neutral:adopted` is the adoption ENGAGEMENT record (LLP 0037, retiming LLP 0031):
// stamped set-if-absent on the first tick that observes an open adopt-labelled PR —
// the acknowledgment that neutral has taken the delegation on — with LLP 0031's
// merged sweep kept as backstop. Add-only: engagement cannot un-happen, so unlike
// `neutral:approved` (head-keyed, stripped on regression) it cannot go stale.
// @ref LLP 0037#engagement [implements] — the engagement-record label
export const ADOPTED_LABEL = 'neutral:adopted'
// The reconcilePR review rung's fix-loop bound: past this many rounds with the head
// still unreviewed, the PR is surfaced as stuck rather than churned forever.
// @ref LLP 0009#pr-health-reconciler [implements] — N=2 fix rounds
export const DEFAULT_REVIEW_ROUNDS = 2
// Context-autophagy trigger: on an idle tick, recycle the orchestrator's context once
// its measured size exceeds this many tokens. A single tuning constant, set BELOW the
// harness auto-compact threshold so the recycle fires before lossy summarization —
// generous on a 1M-window model. Empirical to tune, not a design unknown.
// @ref LLP 0013#trigger [implements] — the threshold T
export const DEFAULT_CONTEXT_THRESHOLD = 500_000
// Idle-initiative cooldowns (LLP 0047): after a repo-hygiene member's PR reaches a
// terminal disposition, the member waits this many wall-clock hours before it may run
// again. Two, because the dispositions mean opposite things: a rejection ("stop
// proposing this") backs off LONGER than an acceptance. Per-repo tunable; 0 disables
// that arm. Empirical to tune, not a design unknown.
// @ref LLP 0047#cooldown [implements] — the two disposition-keyed cooldowns
export const DEFAULT_COOLDOWN_AFTER_MERGE_HOURS = 24
export const DEFAULT_COOLDOWN_AFTER_REJECT_HOURS = 168

/** @type {NeutralConfig} */
export const DEFAULT_CONFIG = {
  // Where the LLP corpus lives.
  llpDir: 'llp',
  // Source-code discovery for `@ref` coverage. Broad by default so an existing
  // repo's annotations (wherever its code lives) count — not just src/bin/test.
  code: {
    exts: [
      '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.rb',
      '.java', '.kt', '.scala', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php',
      '.swift', '.sh', '.bash', '.lua', '.ex', '.exs', '.clj', '.cljs', '.dart',
      '.vue', '.svelte', '.sql', '.graphql'
    ],
    exclude: [
      'node_modules', '.git', 'dist', 'build', 'out', 'vendor', 'target',
      '.next', 'coverage', '.venv', 'venv', '__pycache__', '.neutral'
    ]
  },
  // Type -> pipeline role. A project can remap these (e.g. say `plan` is a human
  // doc here, not a neutral impl-design) without touching code.
  roles: {
    request: ['spec', 'rfc', 'issue'],
    design: ['design', 'plan']
  },
  // Statuses that mean a request has left Draft and is live.
  liveStatuses: ['accepted', 'active'],
  // The reconcilePR review-rung fix-loop bound (LLP 0009): how many review rounds a
  // PR may go through before neutral surfaces it as stuck instead of churning it.
  maxReviewRounds: DEFAULT_REVIEW_ROUNDS,
  // Opt-in: let the terminal reconcilePR rung squash-merge a finished PR
  // (mergeable ∧ green ∧ reviewed) instead of holding it for a human. Off by
  // default — the hold-for-a-human boundary (LLP 0008) stands unless the repo
  // owner moves it here, in a tracked, reviewed file.
  // @ref LLP 0019 [implements] — automerge relaxes the hold, never the gates
  automerge: false,
  // Context-autophagy trigger threshold T, in tokens (LLP 0013). Per-repo tunable.
  contextRecycleThreshold: DEFAULT_CONTEXT_THRESHOLD,
  // Repo-hygiene autophagy members (LLP 0036). On by default — output is a held PR
  // a human disposes of, so the never-merge boundary is the safety; a repo that
  // wants no unprompted cleanup PRs switches the member off here.
  // @ref LLP 0036#eligibility [implements] — the per-repo off-switch
  autophagy: {
    codeCleanup: true,
    // Idle-initiative cooldowns, wall-clock hours (LLP 0047). A member backs off this
    // long after its cleanup PR is disposed — longer after a rejection than a merge.
    // @ref LLP 0047#cooldown [implements]
    cooldownAfterMergeHours: DEFAULT_COOLDOWN_AFTER_MERGE_HOURS,
    cooldownAfterRejectHours: DEFAULT_COOLDOWN_AFTER_REJECT_HOURS
  }
}

/**
 * @param {NeutralConfig} base
 * @param {any} over
 * @returns {NeutralConfig}
 */
function merge(base, over) {
  const o = over && typeof over === 'object' ? over : {}
  const code = o.code && typeof o.code === 'object' ? o.code : {}
  const roles = o.roles && typeof o.roles === 'object' ? o.roles : {}
  return {
    llpDir: o.llpDir || base.llpDir,
    code: {
      exts: Array.isArray(code.exts) ? code.exts : base.code.exts,
      exclude: Array.isArray(code.exclude) ? code.exclude : base.code.exclude
    },
    roles: {
      request: Array.isArray(roles.request) ? roles.request : base.roles.request,
      design: Array.isArray(roles.design) ? roles.design : base.roles.design
    },
    liveStatuses: Array.isArray(o.liveStatuses) ? o.liveStatuses : base.liveStatuses,
    maxReviewRounds: Number.isInteger(o.maxReviewRounds) && o.maxReviewRounds > 0
      ? o.maxReviewRounds
      : base.maxReviewRounds,
    automerge: typeof o.automerge === 'boolean' ? o.automerge : base.automerge,
    contextRecycleThreshold: Number.isInteger(o.contextRecycleThreshold) && o.contextRecycleThreshold > 0
      ? o.contextRecycleThreshold
      : base.contextRecycleThreshold,
    autophagy: {
      codeCleanup: typeof (o.autophagy && o.autophagy.codeCleanup) === 'boolean'
        ? o.autophagy.codeCleanup
        : base.autophagy.codeCleanup,
      // 0 is a valid value (disables the arm), so the gate is `>= 0`, not `> 0`.
      cooldownAfterMergeHours: hoursOr(o.autophagy && o.autophagy.cooldownAfterMergeHours, base.autophagy.cooldownAfterMergeHours),
      cooldownAfterRejectHours: hoursOr(o.autophagy && o.autophagy.cooldownAfterRejectHours, base.autophagy.cooldownAfterRejectHours)
    }
  }
}

/**
 * A non-negative integer hour count, or the fallback. 0 is valid (disables the cooldown).
 * @param {any} v
 * @param {number} fallback
 * @returns {number}
 */
function hoursOr(v, fallback) {
  return Number.isInteger(v) && v >= 0 ? v : fallback
}

/**
 * Load `.neutral/config.json` merged over the defaults.
 * @param {string} repo
 * @returns {NeutralConfig}
 */
export function loadConfig(repo) {
  let raw
  try {
    raw = JSON.parse(readFileSync(join(repo, '.neutral', 'config.json'), 'utf8'))
  } catch {
    return DEFAULT_CONFIG
  }
  return merge(DEFAULT_CONFIG, raw)
}
