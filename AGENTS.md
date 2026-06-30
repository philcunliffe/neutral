# Repository Guidance

Neutral is a set of **declarative reconcilers** that drive out-of-draft LLPs
through technical design → implementation design → task fan-out → integration
PR → review. Each reconciler holds an invariant (a *base state*) and closes the
gap from **observed git/file ground truth** — never a self-reported ledger.

## Design docs (LLP)

Design rationale lives in numbered **LLP documents** under `llp/`, following
Linked Literate Programming. Start at [`llp/0000-neutral.explainer.md`](llp/0000-neutral.explainer.md)
for the system map, [LLP 0001](llp/0001-reconciler-architecture.decision.md)
for why reconcilers replace imperative formulas, [LLP 0002](llp/0002-ground-truth.principle.md)
for the no-fabrication principle, and [LLP 0003](llp/0003-coverage-and-change-sets.spec.md)
for the coverage invariant, change-set DAG, and ready-queue.

- **Read before you change.** Before modifying a subsystem, read the LLP tagged
  with its `Systems` value (`Core`, `Engine`, `Designer`, `Engineer`,
  `Reviewer`).
- **Annotate non-obvious decisions.** When code realizes a documented decision,
  add `// @ref LLP NNNN#anchor — short gloss` (relations: `[implements]`,
  `[constrained-by]`, `[tests]`) directly above the construct — a blank line
  breaks attachment.
- **Immutable docs; change is a new request.** An Accepted/Active LLP is a
  *record*, not a worksheet — don't edit what it decided or required. Express a
  change by minting a **new request** (`rfc`/`spec`/`issue`) that `@ref`s what it
  supersedes, and append a `Superseded-by:`/`Extended-by: LLP NNNN` forward-ref
  to the applicable parts of the old doc. Trivial editorial fixes (typos, links,
  forward-refs) are fine; Drafts are still editable. The new request rides the
  existing coverage trigger — no new mechanism. See
  [LLP 0015](llp/0015-immutable-llps.decision.md).

## The one non-negotiable: ground truth, never self-report

"Done" is always a fact you can re-derive from the world, never a field an agent
wrote. A task is merged only when its branch is a verified ancestor of the
integration branch (`git merge-base --is-ancestor`). Coverage is real `@ref`
annotations, not a claim. See [LLP 0002](llp/0002-ground-truth.principle.md).

## Code style

- JavaScript, ESM, **no semicolons**.
- Types are defined in JSDoc comments, not TypeScript.
- Never use inline `import('...')` types. Declare type imports at the top of the
  file with `@import` JSDoc comments, then reference the bare names.
- Do not use `@typedef`. Define shared types as `interface`s in `.d.ts` files
  and import them via `@import`.
- Node 20+. No runtime dependencies in the deterministic core; it must be
  testable without network or a GitHub remote.

## Checks

- `npm test` runs the deterministic suite (`node --test`). Add tests for all
  deterministic logic: LLP parsing, `@ref` coverage, the ready-queue, status
  rendering, DAG topo-ordering.
- `npm run typecheck` runs `tsc --noEmit` over the JSDoc-typed sources.
- The deterministic core (`src/llp.js`, `src/refs.js`, `src/coverage.js`,
  `src/ready.js`, and the pure maintenance classifiers `src/prhealth.js`,
  `src/issuefix.js`) never shells out — so the rung ladder and issue-fix logic are
  unit-tested offline. Only the controllers shell out: `src/git.js` (git) and
  `src/github.js` (`gh`).
