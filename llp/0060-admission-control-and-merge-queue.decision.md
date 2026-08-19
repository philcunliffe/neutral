# LLP 0060: Bound active work and delegate freshness to the merge queue

**Type:** Decision
**Status:** Accepted
**Systems:** Engine, Engineer, Reviewer
**Author:** Phil / Codex
**Date:** 2026-08-19
**Related:** 0002, 0007, 0008, 0009, 0017, 0019, 0030, 0052

## Context

Neutral previously treated every branch-disjoint gap as permission to start more
work. Review could therefore create a positive-feedback loop: several PRs generated
several reviews, non-blocking findings generated `neutral:fix` issues, and the next
tick generated still more PRs. At the same time, every advance of the target branch
made the remaining own PRs `BEHIND`; the mergeable rung merged the target into all of
them, invalidating head-keyed reviews and checks and creating another round of work.

GitHub's merge queue can validate a PR against the latest target in a synthesized
merge group. It removes the need to keep every candidate branch freshly merged, but
it does not limit how much work Neutral starts. The two controls are complementary:
bound admission before work fans out, then let the queue serialize landing.

## Decision

<a id="admission-control"></a>
### Admission control

Add `maxActiveWork` to `.neutral/config.json`, default **4**. A non-negative integer
is valid; `0` is an explicit intake stop. One slot is consumed by each distinct,
non-frozen work surface Neutral already owns:

- an in-scope open PR, including a reviewed-clean PR waiting to land;
- an unshipped `integration/*` change set without its own open PR;
- a `fix/issue-*` attempt branch without its own open PR.

The observations are deduplicated, so an integration branch and its PR are one
surface, not two. A `neutral:stuck` PR that owes only its report or awaits a human,
or a `neutral:stuck` issue, is **frozen**: it remains visible but consumes no slot.
A human reply makes a stuck PR active again at its `unstick` action.

`neutral observe` emits the complete `admission` decision (`limit`, `used`,
`available`, `open`, active surfaces and frozen surfaces). The skill acts on it; it
does not recount work. At capacity:

- every existing change set and PR continues through its owed action;
- triage may record deferred findings as a `neutral:fix` issue, preserving the
  finding, but the issue-fix worker does not start a branch until a slot opens;
- no new design/change-set branch, design-first integration branch, issue-fix
  branch, or repo-hygiene PR is started.

When slots are available, a tick may admit at most `available` new surfaces. A
Designer may therefore mint at most that many change sets, not the whole backlog.
Once a branch is minted it appears in the next observation and consumes its slot.
The cap throttles intake only; it is never a reason to stop healing admitted work.

<a id="merge-queue"></a>
### Merge queue

Add `mergeQueue` to `.neutral/config.json`, default **false**. It is an opt-in
landing strategy for a repository whose target branch is configured to require a
GitHub merge queue. `automerge` remains the authority boundary:

- `mergeQueue: true`, `automerge: false` keeps the human-held terminal, while the
  queue still owns base freshness;
- both true change the own reviewed-clean terminal from `merge` to `enqueue`.

For own PRs in queue mode, `BEHIND` is not a heal action. Real conflicts (`DIRTY`),
current-head checks, current-head review and `neutral:stuck` retain their existing
precedence. At the reviewed-clean terminal, `enqueue` flips a draft ready and runs
`gh pr merge <N> --squash --match-head-commit <headSha>`. On a queue-required target,
GitHub adds the exact head to the queue and validates the synthesized merge group.

> **Extended-by [LLP 0061](0061-explicit-merge-queue-enqueue.decision.md):** a live
> queue exposed `gh pr merge` falling back to disabled auto-merge. The executor is
> now `neutral enqueue`, backed by GraphQL `enqueuePullRequest` with `expectedHeadOid`.

Queue membership is read from the Pull Request GraphQL `mergeQueueEntry` field.
While an entry exists, the classifier returns `wait` with `approved: true`; it does
not re-enqueue, merge the target into the branch, or repeat review. If GitHub drops
the entry, the next observation re-derives the ordinary rungs and may enqueue again.
Foreign review-only PRs retain their existing contributor-facing freshness rules.

## Consequences

- Review follow-ups become backlog while capacity is full instead of recursively
  becoming immediate PRs.
- A long-lived reviewed PR still applies useful backpressure until it lands; a truly
  stuck one does not freeze the whole system.
- Queue-enabled repositories stop rewriting every own PR when the target advances.
  Merge-group CI, not branch churn, proves integration freshness.
- Repositories without queue configuration preserve the existing `merge-base` and
  direct `merge` behavior. `automerge` and `mergeQueue` remain explicit opt-ins.
