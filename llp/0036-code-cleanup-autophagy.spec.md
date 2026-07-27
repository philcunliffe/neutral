# LLP 0036: Code cleanup — the first repo-hygiene autophagy member

**Type:** Spec
**Status:** Accepted
**Systems:** Core, Engine
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0008, 0009, 0011, 0013, 0019, 0035

## Purpose

The first **repo-hygiene** member of the autophagy family (LLP 0011 roadmap:
"dead-code trim"), widened slightly to **code cleanup**: on an idle tick, spend
slack capacity removing dead code and applying mechanical tidying, delivered as a
**held PR** a human disposes of. Like every repo-hygiene member it is a scavenger,
not a reconciler — no invariant is violated by dead code; the member takes an
opportunity, it never restores a base state (LLP 0011).

All three family rules bind this member: **slack-only**, **held never merged**,
**propose never assert**.

## Trigger

Selected by the idle-initiative decision (LLP 0035): `neutral idle --json` returns
`initiative: "cleanup"` iff the tick is **idle**, the context recycle is **not**
due (runtime preempts repo hygiene, LLP 0035 §priority), and the member is
**eligible** (below). The orchestrator acts on that field; it never re-derives the
selection in prose (LLP 0002).

### <a id="eligibility"></a>Eligibility — ground truth, pure, offline-testable

A pure classifier over the `neutral prs` observe output plus config
(`src/autophagy.js`), like the idle predicate itself:

- **`autophagy.codeCleanup` is `true`** (`.neutral/config.json`; default `true`).
  The per-repo off-switch — a repo that wants no unprompted cleanup PRs sets it
  `false` in a tracked, reviewed file.
- **No open PR whose head starts `autophagy/`.** This is LLP 0011's backoff
  ("don't open 40 dead-code PRs") made mechanical: at most **one** autophagy PR
  exists at a time, and a held-but-unreviewed cleanup PR blocks the next
  initiative until the human disposes of it. Observable from the same open-PR
  listing the maintenance family already reads — no new state.

## <a id="initiative"></a>The initiative

One worker, in its **own worktree** (LLP 0012) off the target branch, on branch
**`autophagy/cleanup-<yyyy-mm-dd>`**. The `autophagy/` prefix is scope-defining:
it admits the PR into the own-PR maintenance ladder (LLP 0009) and is the
eligibility gate's signal above.

### <a id="scope"></a>Scope — high-confidence, mechanically verified only

A construct (export, function, file, branch of code) may be trimmed **only** when
its unreachability is re-derivable by grep over the repo, not judged:

- no importer anywhere in the tree,
- no test references it,
- no `@ref` annotation attaches to it (an annotated construct realizes a
  documented decision — never scavenged),
- not a package entry point (`package.json` `main`/`exports`/`bin`), a CLI
  surface, or documented public API,
- no dynamic-dispatch / reflection / string-keyed reachability in sight.

Plus **mechanical tidy**: unused imports, unreachable statements after a
return/throw, leftover commented-out code blocks. **Never style churn** — no
reformatting, no renames, no refactors, no "improvements". Anything short of
mechanical confidence is left in place (propose-never-assert, LLP 0011): when in
doubt, it is not dead.

### <a id="evidence"></a>Evidence — the PR body carries the proof

The PR body lists **every** trim with its reachability evidence (the searches
that came back empty). The PR *proposes*; the human review *disposes*. A trim
whose evidence cannot be stated mechanically does not belong in the PR.

### Delivery

- The repo's own checks must pass in the worktree before the PR opens; CI on the
  PR is the authority that they do (LLP 0002).
- The PR opens as a **draft** and is carried by `reconcilePR` to
  *mergeable ∧ green ∧ reviewed* like any own PR (LLP 0009, LLP 0011
  held-never-merged).
- <a id="no-automerge"></a>**Held even under `automerge: true`.** LLP 0019's
  opt-in covers reconciler output that closes a human-authored request; a
  scavenger's unprompted deletion proposal always waits for a human. The rung
  selection disables the automerge terminal for `autophagy/` heads.
- **No-op is a valid outcome.** When nothing qualifies, the worker opens no PR
  and the tick logs `action=cleanup-noop`. Re-scanning on a later idle tick is
  idempotent and safe; the orchestrator MAY dampen repeat no-op scans within its
  own session (a scheduling hint, not a fact claim — LLP 0002 governs facts).

## Requirements

- **R1 — Slack-only, selected by LLP 0035.** Runs only when `neutral idle`
  names it; any real gap, and the context recycle, preempt it.
- **R2 — One autophagy PR at a time.** The eligibility gate blocks on any open
  `autophagy/` PR.
- **R3 — Mechanically verified trims only.** Every deletion carries re-derivable
  reachability evidence in the PR body; sub-mechanical confidence ⇒ no trim.
- **R4 — Held, never merged — even under automerge** (§no-automerge).
- **R5 — Checks green by the repo's own CI**, carried by the existing ladder;
  no new merge machinery.
- **R6 — Deterministic gate.** Eligibility and initiative selection are pure
  functions in the core, offline-tested; only the worker's trim judgment is LLM.

## Realization

- `src/autophagy.js` — the pure eligibility classifier (`cleanupState`) and the
  `autophagy/` branch-prefix constant.
- `src/commands/idle.js` — `neutral idle --json` gains `cleanup` and the
  selected `initiative` (LLP 0035 §cli-selects).
- `src/commands/prs.js` — `autophagy/` joins the own-head scope so the ladder
  carries cleanup PRs; the automerge terminal is disabled for them
  (§no-automerge).
- `src/config.js` — the `autophagy.codeCleanup` switch.
- The `neutral-reconcile` skill — the end-of-tick branch becomes the initiative
  selection, and the cleanup worker brief lives there.

Code realizing this spec annotates `// @ref LLP 0036#... [implements]`.

## Out of scope

- **The other roadmap members** (LLP repair, coverage backfill, branch prune,
  worktree prune, dependency hygiene) — each still gets its own spec (LLP 0011).
- **A cross-tick no-op cooldown record** (e.g. "don't re-scan until the target
  head moves") — a possible spend optimization; v1 accepts the idempotent
  re-scan. Open question for a later revision.

## References

- [LLP 0011](0011-autophagy.rfc.md) — the family, the three rules, and the
  roadmap row this member implements
- [LLP 0035](0035-idle-initiative-selection.decision.md) — how this member gets
  selected on an idle tick
- [LLP 0013](0013-context-autophagy.spec.md) — the sibling runtime member that
  preempts it
- [LLP 0009](0009-maintenance-reconcilers.spec.md) — the ladder that carries the
  cleanup PR
- [LLP 0019](0019-automerge.decision.md) — the opt-in this member is exempt from
- [LLP 0002](0002-ground-truth.principle.md) — evidence-carried proposals, never
  asserted trims
