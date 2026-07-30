# LLP 0050: Merge notes live in the PR description — a loop-maintained ⚠️ block

**Type:** Decision
**Status:** Accepted
**Systems:** Engine, Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-30
**Related:** 0002, 0003, 0009, 0030, 0041, 0049

## Context

Merge complications — this change set's `Depends-on:` predecessor is not
merged yet; merging this now reorders the DAG — were visible only in Slack
(stuck reports, mayor messages). But the merge button lives on GitHub, and
the human merging from the PR page may never see Slack. The warning belongs
where the act happens.

The loops, not the mayor, own this: the loop holds the repo clone and
already computes predecessor state (`changeSetMergedToTarget`, LLP 0003's
change-set DAG); the mayor's authority is report + relay (LLP 0041) and it
holds no repo.

## Decision

<a id="merge-notes-block"></a>**For every own open PR, the reconcile loop
maintains a merge-notes block at the top of the PR description** — fenced
by markers so the edit is mechanical and idempotent:

```
<!-- neutral-merge-notes -->
> ⚠️ **Merge notes**
> - Merge hyparam#41 (`integration/frobnicate-core`) first — this change
>   set depends on it and is branched from its history.
<!-- /neutral-merge-notes -->
```

One bullet per consideration, **re-derived from ground truth each tick**
(LLP 0002), never remembered. v1 derives one fact: each unmerged
`Depends-on:` predecessor, with its PR number when one exists (else its
integration branch name). Further derivable facts may join by extending
this list in a new request doc; opinions and prose caveats never do. When
no considerations remain, the whole block (markers included) is removed.

<a id="banner-sync"></a>**The sync is mechanical — no agent, not a rung.**
It runs alongside the `neutral:approved` label sync (LLP 0030's slot in
reconcilePR): read the current body, compute the block from ground truth,
`gh pr edit N --body` only when they differ. Editing a body is reversible
annotation — no LLP 0041 §no-irreversible concern. The rest of the body is
never touched; a PR body without markers gets the block prepended plus a
blank line.

<a id="view-not-source"></a>**The block is a rendered view, never a
source.** Nothing reads it back — not the loop, not the mayor. The mayor's
card warning section (LLP 0049 §card-shape) shows the same facts by
deriving them the same way, not by scraping the PR body (LLP 0002).

## Consequences

- Reconcile skill: reconcilePR gains the merge-notes sync beside the
  approved-label sync.
- Mayor skill: the card's ⚠️ warning derives from the same predecessor
  facts (`neutral prs --json` + change-set `Depends-on:`), so both surfaces
  agree without either reading the other.
- `fix/issue-*` PRs have no change-set predecessors; v1 gives them no block.
