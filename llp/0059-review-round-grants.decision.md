# LLP 0059: Review-round budget grants from the PR thread

**Type:** Decision
**Status:** Accepted
**Systems:** Reviewer
**Author:** Phil / Claude
**Date:** 2026-08-09
**Related:** 0002, 0009, 0017, 0026, 0027, 0029, 0041, 0042

## Context

The review fix-loop is bounded by `maxReviewRounds`, a repo-wide config knob
(default 2). At the cap the loop triages: residual findings are deferred to a
`neutral:fix` follow-up or the PR is parked `neutral:stuck` (LLP 0017). Sometimes a
human watching one PR wants the opposite — *keep fixing, take another round* — and
today their only lever is editing `.neutral/config.json`, which moves the bound for
every PR in the repo and needs a commit. There is no per-PR, per-ask way to say
"spend more review effort here", either directly on the PR or through the mayor.

## Decision

<a id="thread-grants"></a>**A `neutral: rounds +N` line in a PR comment raises that
PR's review-round cap by N.** The effective cap is `maxReviewRounds` plus the sum of
every qualifying grant in the thread, re-derived from the observed comments each tick
(LLP 0002) — never stored. Grants are increase-only (`+N`), PR-scoped, and lifetime
rather than head-keyed: the thing they extend — the round count (LLP 0029) — is
itself cumulative across heads, so a grant is naturally consumed by the rounds it
pays for. The directive is line-anchored (start of line), so machinery that merely
*quotes* the syntax mid-sentence (e.g. a stuck report explaining the lever) cannot
grant.

<a id="who-grants"></a>**A grant carries a human's authority, read from authorship.**
A qualifying comment is either a **human comment** — the LLP 0027 discriminator: no
`<!-- neutral-… -->` marker, not a `[bot]` — or a **mayor-authored comment** carrying
`<!-- neutral-mayor -->` (LLP 0042). The mayor exception exists because the mayor
authors comments only on a human's explicit Slack ask (LLP 0041 §identity-principle):
it is the one neutral-marked comment that still relays a human's say-so. Neutral's
own review/stuck/triage machinery can never extend its own budget.

<a id="mayor-relay"></a>**Two ways to grant via Slack, one mechanism.** A reply under
the PR's Slack root that already contains a literal `neutral: rounds +N` line rides
the mayor's ordinary verbatim, unmarked relay (LLP 0042 §stuck-relay) and grants as a
human comment. A loose ask *to* the mayor ("give #12 two more review rounds") cannot
be relayed verbatim to any effect, so the mayor authors the canonical line itself —
`<!-- neutral-mayor -->` first, then `neutral: rounds +N — granted by <user> via
Slack` — and that comment grants under the mayor exception above.

## Consequences

- `src/prhealth.js` — a pure `grantedReviewRounds(comments)` sums qualifying grants;
  `selectRung` triages against `maxReviewRounds + granted` and says so in the reason
  when a grant is in play. Deterministic, unit-tested offline (CLAUDE.md §Checks).
- The mayor skill gains the authored-grant case; the reconcile skill notes the cap
  folds in thread grants (the CLI decides, as ever — no skill-side arithmetic).
- A grant posted after a triage marker already covers the head changes nothing until
  the head moves (the triage marker satisfies the reviewed rung, LLP 0017); granting
  is a *pre-triage* lever, or takes effect at the next head.
- Review-only foreign PRs are unaffected — they have no fix loop and no cap
  (LLP 0058).
