# LLP 0037: `neutral:adopted` marks engagement, not completion

**Type:** Decision
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0024, 0025, 0030, 0031

## Context

LLP 0031 made `neutral:adopted` the adoption **completion record**: applied only once
the PR is observed merged, on the argument that anything pre-merge "duplicates
`neutral:approved` and means nothing". In practice the opposite gap showed up first
(hypaware PR 406, 2026-07-27): a maintainer labels a PR `neutral:adopt` and then
watches for `neutral:adopted` as the **acknowledgment** that the loop has taken the
delegation on — and sees nothing for the entire active phase, because the ladder's
intermediate work is visible only in the thread and the verdict labels arrive late.
The maintainer's mental model of "adopted" is *the delegation was accepted*, not *the
story ended*.

## Decision

<a id="engagement"></a>**`neutral:adopted` is applied at first engagement: the first
tick that observes an open, in-scope PR carrying `neutral:adopt` without
`neutral:adopted` stamps it, set-if-absent, alongside whatever rung action the PR
gets that tick.** Observation *is* engagement — classification is the moment the
loop takes responsibility for driving the PR, even when the tick's action is `wait`
or `held`.

<a id="still-add-only"></a>**Add-only survives the retiming.** LLP 0031's staleness
argument keyed on the labelled fact being immutable. The fact this label now caches —
*neutral has engaged this delegation* — is equally immutable: engagement cannot
un-happen. The label is still never removed, and set-if-absent still makes the
work self-terminating (LLP 0002: derived from the observed label set, not from
memory of prior ticks).

<a id="field-sync"></a>**The CLI decides, the skill applies** (the LLP 0030 pattern,
as 0031 already used): each open adopted PR row from `neutral prs` carries a
`markAdopted` flag — the pure `needsAdoptedLabel` predicate over the observed
labels — and the skill's act is one mechanical `gh pr edit --add-label`, no agent.
Only `neutral:adopt` delegations are stamped; a `neutral:review`-only delegation is
narrower and is **not** an adoption (LLP 0032).

<a id="backstop"></a>**The merged sweep stays as a backstop.** LLP 0031's
merged ∧ adopt ∧ ¬adopted enumeration (`mark-adopted` action rows) is kept: a
delegation merged by the maintainer before the loop ever ticked still gets its
record. With engagement-time stamping the sweep almost never fires — it catches
exactly the PRs neutral never saw while open.

## Supersedes

This retimes [LLP 0031](0031-adopted-label.decision.md): its
[§verdict-time-rejected](0031-adopted-label.decision.md#verdict-time-rejected)
argument ("adopted must mean landed") is **overturned by the label's owner** — the
maintainer reads `adopted` as the acknowledgment of the delegation, and the
completion fact remains queryable without a label
(`is:merged label:neutral:adopt`). Everything else in 0031 stands: add-only,
set-if-absent, the CLI-decides pattern, keeping `neutral:adopt` in place
(the label-swap rejection, LLP 0024), and the merged sweep itself (§backstop).

## Consequences

- **The label no longer distinguishes landed from in-flight adoptions.** A
  maintainer wanting completions filters `is:merged label:neutral:adopt`; the
  label's job is now the immediate "neutral has it" signal.
- `src/commands/prs.js` adds `markAdopted` to open-PR rows (reusing
  `needsAdoptedLabel`); the merged-sweep rows are unchanged.
- The reconcile skill stamps the label as a mechanical side act on first touch and
  keeps `mark-adopted` as the merged backstop.
- [LLP 0031](0031-adopted-label.decision.md) gains the `Superseded-by` forward-ref.
