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
  /**
   * Planner-rated complexity 1–5 (LLP 0022): the model-tier seed for the task's
   * first implementation attempt (1–3 → mechanical, 4 → worker, 5 → judgment).
   * Absent ⇒ mechanical. Seeds only the entry rung of the LLP 0021 ladder.
   */
  complexity?: number
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
 * One comment in a PR's thread, from `gh pr view --json comments`. Neutral posts
 * through the repo owner's own gh auth, so `author` cannot distinguish neutral from
 * the human — neutral's comments are recognised by their `<!-- neutral-… -->` body
 * markers instead (LLP 0026/0027).
 */
export interface PrComment {
  /** author.login; bots end in `[bot]`. */
  author: string
  body: string
  /** ISO 8601; gh returns comments in chronological order. */
  createdAt: string
}

/**
 * One recorded review round (LLP 0028/0029): a `<!-- neutral-review: <sha> <verdict> -->`
 * marker, normally signing a comment — the comment IS the round (LLP 0028) — or a
 * legacy PR-body marker (always clean: the body form was only ever written on success).
 */
export interface ReviewRecord {
  /** The head SHA the round covered, possibly abbreviated. */
  sha: string
  /** True when the round found nothing actionable. Only a clean record covering the current head satisfies the reviewed rung; a `findings` record counts the round toward `maxReviewRounds` without satisfying it (LLP 0029). */
  clean: boolean
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
  /** PR body — carries the `<!-- neutral-triage: … -->` / `<!-- neutral-verdict: … -->` markers, plus legacy `<!-- neutral-review: … -->` markers (new review records live in the comment thread — LLP 0028). */
  body: string
  /** Label names. `neutral:stuck` is the human-held authorization boundary: when set, neutral could not auto-advance and the loop must not churn the PR (LLP 0009). `neutral:adopt` triggers foreign adoption (LLP 0025). */
  labels: string[]
  /** Whether neutral can push a heal to the head branch (LLP 0025): `!isCrossRepository || maintainerCanModify`. Own PRs are always pushable; a cross-repo fork only while the contributor allows maintainer edits. Absent ⇒ pushable. */
  canPush?: boolean
  /** True when this PR is *adopted* — foreign (not neutral's own), triggered by a `neutral:adopt` label (LLP 0025). Set at collection; own PRs leave it unset (⇒ the own-PR ladder). */
  foreign?: boolean
  /** The comment thread, chronological — carries the marker-signed review records (LLP 0028), the stuck report, and the human replies that unstick a held PR (LLP 0026/0027). */
  comments: PrComment[]
}

/** The single rung action reconcilePR takes on a PR this tick (LLP 0009). */
export interface RungDecision {
  /** mergeable | green | reviewed | terminal. */
  rung: string
  /**
   * wait | merge-base | resolve-conflict | fix-ci | review | triage | ready-hold | merge |
   * stuck-report | unstick | held | approve | request-changes.
   * `triage` (review rounds exhausted) is where a blanket `stuck` used to be: the worker
   * judges the residual findings and either defers non-blockers to a `neutral:fix` follow-up
   * (shipping the PR) or sets the `neutral:stuck` label itself (LLP 0017). `selectRung` no
   * longer emits `stuck` as an action — the label, once set, short-circuits into a three-way
   * classifier over the comment thread (LLP 0026/0027): `stuck-report` when no marker-signed
   * stuck report exists yet (post it), `unstick` when a human replied after the latest report
   * or pushed since it (remove the label, ack, re-run the rungs next tick), else `held`.
   * `merge` is the terminal action only when the repo opted in (`automerge`, LLP 0019):
   * flip ready if draft, then squash-merge — instead of `ready-hold`/`held`.
   * `approve` / `request-changes` are the terminal + degraded actions for an *adopted* foreign
   * PR (LLP 0025): they set the `neutral:approved` / `neutral:changes-requested` verdict labels
   * instead of readying or merging a contributor's PR. `request-changes` also stands in for a
   * heal rung (merge-base/resolve-conflict/fix-ci) neutral cannot perform when it can't push.
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
