// Shared types for the neutral engine. Imported into JS via `@import`.
// @ref LLP 0003 — the Engine's data model

export interface Llp {
  number: number
  /** Kebab slug from the filename `NNNN-<slug>.<type>.md`. */
  slug: string
  type: string
  title: string
  status: string
  systems: string[]
  author: string
  date: string
  path: string
  /** LLP numbers this doc `@ref`s in its body (a design's coverage list). */
  refs: number[]
  /** Change sets this one depends on, from a `**Depends-on:**` header. */
  dependsOn: string[]
  /** Reconciler that minted this doc, from a `**Generated-by:**` header. */
  generatedBy?: string
}

export interface CoveredLlp {
  llp: Llp
  /** Design LLP ids (zero-padded) and/or the literal `'code'`. */
  by: string[]
}

export interface CoverageResult {
  /** Live request LLPs that need coverage. */
  eligible: Llp[]
  covered: CoveredLlp[]
  /** The Designer backlog: live requests covered by neither a design nor code. */
  uncovered: Llp[]
  /** LLPs acting as designs (type in DESIGN_TYPES). */
  designs: Llp[]
}

export interface Task {
  id: string
  branch: string
  deps: string[]
  brief?: string
}

export interface ReadyResult {
  ready: Task[]
  blocked: Task[]
  done: Task[]
}

export interface NeutralConfig {
  /** Directory holding the LLP corpus (relative to repo root). */
  llpDir: string
  /** Source-code discovery for `@ref` coverage. */
  code: {
    exts: string[]
    exclude: string[]
  }
  /** Type -> pipeline role mapping. */
  roles: {
    request: string[]
    design: string[]
  }
  /** Statuses that count as live (left Draft). */
  liveStatuses: string[]
  /** reconcilePR review-rung fix-loop bound before a PR is surfaced as stuck. */
  maxReviewRounds: number
  /** Opt-in (LLP 0019): terminal rung squash-merges a finished PR instead of holding it. */
  automerge: boolean
  /** Context-autophagy trigger threshold T, in tokens (LLP 0013). */
  contextRecycleThreshold: number
}

export interface World {
  repo: string
  config: NeutralConfig
  llps: Llp[]
  coverage: CoverageResult
}

/**
 * A PR's observed health from `gh pr view --json` — GitHub's own computation, read
 * fresh against the current head SHA (LLP 0002/0009), not the acting agent's claim.
 */
export interface PrObservation {
  number: number
  /** headRefName — the PR's source branch. */
  head: string
  /** baseRefName — the PR's target branch. */
  base: string
  isDraft: boolean
  /** MERGEABLE | CONFLICTING | UNKNOWN. */
  mergeable: string
  /** BEHIND | DIRTY | CLEAN | BLOCKED | UNSTABLE | UNKNOWN | DRAFT | HAS_HOOKS. */
  mergeStateStatus: string
  /** The raw statusCheckRollup array; rollupConclusion() reduces it. */
  rollup: any[]
  /** headRefOid — every downstream fact (green, reviewed) is keyed to this. */
  headSha: string
  /** PR body — carries the `<!-- neutral-review: <sha> -->` markers. */
  body: string
  /** Label names. `neutral:stuck` is the human-held authorization boundary: when set, neutral could not auto-advance and the loop must not churn the PR (LLP 0009). */
  labels: string[]
}

/** The single rung action reconcilePR takes on a PR this tick (LLP 0009). */
export interface RungDecision {
  /** mergeable | green | reviewed | terminal. */
  rung: string
  /**
   * wait | merge-base | resolve-conflict | fix-ci | review | triage | ready-hold | merge | held.
   * `triage` (review rounds exhausted) is where a blanket `stuck` used to be: the worker
   * judges the residual findings and either defers non-blockers to a `neutral:fix` follow-up
   * (shipping the PR) or sets the `neutral:stuck` label itself (LLP 0017). `selectRung` no
   * longer emits `stuck` as an action — the label, once set, short-circuits to `held`.
   * `merge` is the terminal action only when the repo opted in (`automerge`, LLP 0019):
   * flip ready if draft, then squash-merge — instead of `ready-hold`/`held`.
   */
  action: string
  reason: string
}

/** One reason a tick is not idle: a gap still in flight in one of the families (LLP 0013). */
export interface IdleBlocker {
  /** pipeline | maintenance. */
  family: string
  /** The gap's target — `llp#N` | `pr#N` | `issue#N`. */
  target: string
  reason: string
}

/**
 * Whether a tick is at rest across both reconciler families, with the blockers that
 * hold it open (empty ⇔ idle). Half the context-autophagy trigger (LLP 0013).
 */
export interface IdleState {
  idle: boolean
  blockers: IdleBlocker[]
}

/** A `neutral:fix` issue's fix-attempt state, re-derived from ground truth (LLP 0009). */
export interface IssueFixState {
  number: number
  title: string
  /** needs-fix | attempt-exists | stuck. */
  state: 'needs-fix' | 'attempt-exists' | 'stuck'
  /** how an attempt was found: `branch:fix/issue-N` | `pr:#M` | `label:neutral:stuck`. */
  via?: string
}
