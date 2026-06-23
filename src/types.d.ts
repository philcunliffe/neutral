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

export interface World {
  repo: string
  llps: Llp[]
  coverage: CoverageResult
}
