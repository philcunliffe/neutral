# LLP 0018: Self-clearing blocked PRs — re-engage on a resolved dependency

**Type:** RFC
**Status:** Draft
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-06-30
**Related:** 0000, 0002, 0003, 0008, 0009, 0015, 0016, 0017

## Summary

A PR neutral parks for a needed design decision never re-engages on its own. Once
`reconcilePR` sets `neutral:stuck`, the label is an **unconditional** short-circuit
([`src/prhealth.js`](../src/prhealth.js) `selectRung`): label present → `held`, full stop.
Nothing records *what* the PR is waiting on, nothing polls for its resolution, and nothing
ever removes the label. So when a human goes and solves the blocking design issue
(e.g. a tracked issue `#211`), neutral does not notice — the PR is held forever until a
human manually pulls the label, and even then the ladder re-runs blind and may re-stick on
the same fork. **There is no re-engagement path.** This RFC proposes one.

## Motivation — "blocked" and "stuck" are the same mechanism

The two states neutral has reached for — *blocked on a tracked dependency* and *stuck,
a human must look* — are not different states. They are one state, **a PR held on an
unmet condition**, differing on exactly one axis, asked at the moment neutral parks:

> *Can neutral name, right now, the re-derivable predicate whose flip means "go"?*

- **Yes** → a watchable dependency (`#211` reaches CLOSED/COMPLETED, or a `decision` LLP
  reaches `Accepted`). neutral can poll it and **self-clear**.
- **No** → neutral hit something it cannot even formulate as a waitable condition (a review
  finding it failed to resolve in N rounds, a conflict it backed off, a fork whose answer it
  cannot shape). The only signal of resolution is a **human's say-so**.

The label never carried that distinction — the recorded **`blocked-on:` target** does. "Stuck"
is just `blocked-on: human`: the special case with no machine-checkable predicate. Recognising
this collapses two labels into one and yields a single, ground-truth re-engagement rule.

## Proposal

### 1. One label: `neutral:blocked`

Retire `neutral:stuck`; rename to **`neutral:blocked`** (the more common term). One concept —
held on an unmet condition. (See Rejected: the two-label option and its cost.)

### 2. The `blocked-on:` target is the gate, not the label

A held PR carries `neutral:blocked` the **entire time it is held** — in both the self-clearing
and human-cleared cases — so the label's *presence* cannot decide re-engagement. The
short-circuit in `selectRung` becomes **conditional on the `blocked-on:` predicate** rather than
unconditional. What it is waiting on is recorded as a re-derivable marker on the PR body, a
sibling of the `neutral-review`/`neutral-triage` markers:

- `<!-- neutral-blocked-on: #211 -->` — a watchable artifact → **conditional** hold.
- `<!-- neutral-blocked-on: human -->` (or no link) → **unconditional** hold (today's `stuck`).

### 3. The park-time decision rule

When an agent parks a PR it asks the axis question — *can I name the boolean that means "go"?*
If yes, it files/links the dependency and records `blocked-on: #N`; if no, `blocked-on: human`.
**Filing the dependency is the act that earns self-clearing.** A would-be stuck is *promoted*
to a self-clearing block precisely by externalising its question into a watchable artifact.

### 4. The self-clear predicate (ground truth — LLP 0002)

Each tick, `observe` resolves every `neutral-blocked-on: #N` link's **live** state via `gh`
(`gh issue view N --json state,stateReason`) — re-derived, never a stored flag.
`allBlockersResolved` is **all-or-nothing** across a PR's links (the LLP 0017 discipline). When
true the conditional hold lifts and the rung ladder runs. Removing the `neutral:blocked` label is
**tidy-up to match the predicate, not the trigger** — the predicate is the truth, so neutral can
clear *this* label itself (it cannot clear `blocked-on: human`, which has no predicate).

### 5. Re-engagement = re-run the rung ladder

Lifting the hold just lets `selectRung` return the real rung at the current head. The three
resolution shapes all fold into existing rungs — **no new machinery at the tail**:

- **A — decision needs code on this branch:** the impl/review agent is dispatched with the
  resolution to `@ref`; it commits → head moves → green/reviewed re-open and climb.
- **B — "proceed as-is":** head unchanged; review re-runs and climbs to terminal.
- **C — the resolution merged code to target** (the fix carried the implementation): the branch
  is now `BEHIND` → rung 1 `merge-base` pulls it in. Either residual integration work climbs the
  ladder, or the merged code already satisfies the design's `@ref`s — coverage flips the design
  `Active` ("shipped is Active", LLP 0016) and the change-set PR is **redundant**; neutral surfaces
  it for a human to close (it never destroys).

This **generalises the change-set DAG** (LLP 0003): "a merge unblocks dependents" extends from
change-set→change-set to **PR→dependency**.

## Open questions

- **OQ1 — `not planned` ≠ resolved.** A blocker closed as `not planned` *dismisses* the
  question and may moot the change set. Proposal: do **not** auto-re-engage — rewrite the link to
  `blocked-on: human` and surface ("blocker dismissed — what now?"). Confirm.
- **OQ2 — the truer signal.** Key the predicate on the issue `#N` being CLOSED/COMPLETED (simple,
  matches "the fix merged"), or on the spawned `decision`/`design` LLP reaching `Accepted` (more
  faithful — an issue can close without the design being settled, and it dovetails with
  design-first intake's `Accepted` trigger, LLP 0016)? Or both (issue-**or**-decision)?
- **OQ3 — observe cost.** Resolving each link is one `gh` call per held PR per tick. Fine at
  current scale; note as a cost, revisit caching later. Surface, don't hide (LLP 0002 honesty).
- **OQ4 — migration.** On rollout, treat an existing `neutral:stuck` label as `neutral:blocked`
  + `blocked-on: human` (no predicate) so nothing that was a genuine human halt silently
  self-clears.

## Rejected

- **Two labels (`blocked` self-clearing, `stuck` human-cleared).** Keeps an at-a-glance
  call-to-action — `blocked` = "waiting on tracked work" vs `stuck` = "I need *you*" — but doubles
  the surface for one mechanism. Settled against: one label, with the `blocked-on:` value carrying
  the distinction. **Cost banked:** the label alone no longer tells a human which mode a PR is in;
  they must read its `blocked-on:`.
- **Auto-clear on bare label removal / any issue close.** Re-engaging without a recorded,
  resolved `blocked-on` predicate is a guess — it would re-run the ladder blind and re-stick, or
  resume on an unrelated close. The gate must be a predicate neutral named at park time.
- **A self-reported "unblocked" flag on the PR.** The exact ground-truth violation LLP 0002
  forbids. The signal is the dependency's live state, re-derived each tick.

## Spawns on acceptance

Per house rules an `rfc` stays an `rfc` and spawns its decisions + spec:

- **decision** — collapse to one `neutral:blocked`; retire `neutral:stuck`.
- **decision** — the `blocked-on:` target is the gate (conditional short-circuit).
- **decision** — the self-clear predicate, keyed per OQ2.
- **spec** — the `neutral-blocked-on` marker format, the `observe`/`selectRung` predicate, the
  park-time decision rule, and OQ4 migration. The rename of `STUCK_LABEL`
  ([`src/config.js`](../src/config.js)) and its uses in `prhealth.js`/`issuefix.js`/the
  `neutral-reconcile` skill is implementation detail for the spawned plan.

## Constraints

- `@ref LLP 0009#pr-health-reconciler [constrained-by]` — extends the reviewed rung: its terminal
  `neutral:stuck` becomes a conditional `neutral:blocked`; the rung ladder itself is untouched.
- `@ref LLP 0017 [constrained-by]` — the triage `stuck` outcome becomes `blocked-on: human`; the
  all-or-nothing discipline is reused across multiple blockers.
- `@ref LLP 0002 [constrained-by]` — re-engagement is a re-derived predicate over `gh` state,
  never a self-reported flag; label removal mirrors the predicate, it does not drive it.
- `@ref LLP 0003 [constrained-by]` — generalises "a merge unblocks dependents" from the
  change-set DAG to PR→dependency.
- `@ref LLP 0008 [constrained-by]` — composition: the resolving artifact may itself ride issue-fix
  or design-first intake; the blocked invariant lifts only on their ground-truth completion.
- `@ref LLP 0015 [constrained-by]` — this is the new request superseding the `neutral:stuck`
  naming and unconditional-halt bits of 0009/0017; their decided content stands, forward-refs
  appended **on acceptance**.
- `@ref LLP 0016 [constrained-by]` — OQ2's decision-LLP-`Accepted` signal dovetails with
  design-first intake's `Accepted` trigger.
