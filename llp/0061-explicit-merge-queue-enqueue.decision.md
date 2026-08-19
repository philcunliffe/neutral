# LLP 0061: Enqueue through the explicit merge-queue mutation

**Type:** Decision
**Status:** Accepted
**Systems:** Engine, Engineer
**Author:** Phil / Codex
**Date:** 2026-08-19
**Related:** 0002, 0019, 0060

## Context

LLP 0060 specified `gh pr merge` as the executor for an `enqueue` action, following
the GitHub CLI manual. A live queue-required repository exposed a narrower behavior:
`gh pr merge` rejected an explicit merge strategy, then without the strategy tried
to call `enablePullRequestAutoMerge`. The repository intentionally had auto-merge
disabled because the merge queue, not auto-merge, owns landing. Both forms failed;
GitHub's dedicated GraphQL `enqueuePullRequest` mutation succeeded immediately and
returned the queue entry.

Putting that mutation inline in agent prose would leave quoting, node-id lookup and
head validation to each run. Queue entry is a deterministic side effect and belongs
behind the deterministic CLI boundary.

## Decision

Add `neutral enqueue <pr-number> <expected-head-sha>`. The command:

1. reads the PR's GraphQL node id and current head SHA from GitHub;
2. refuses to act when the current head differs from the reviewed head supplied by
   `neutral prs`;
3. calls `enqueuePullRequest` with both `pullRequestId` and `expectedHeadOid`;
4. requires GitHub to return a real `mergeQueueEntry`, then reports its id, position
   and state.

The reconcile skill executes this command only for the deterministic `enqueue`
action. A later observation still reads `mergeQueueEntry` independently as LLP 0060
requires; the enqueue command's success output is not persisted or trusted as a
queue-membership ledger.

## Consequences

- Queue landing does not depend on the repository-level auto-merge switch.
- The reviewed head is protected both before the mutation and by GitHub's
  `expectedHeadOid` check at mutation time.
- GraphQL quoting and response validation are unit-tested in the engine, while the
  skill remains a small relay from `action=enqueue` to `neutral enqueue`.
