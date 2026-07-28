# LLP 0041: Mayor authority — report + relay; authorship decides the marker

**Type:** Decision
**Status:** Accepted
**Systems:** Engine, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0019, 0026, 0027, 0038, 0039

## Context

Spawned by [RFC 0038](0038-mayor-loop.rfc.md) on acceptance. What may the
mayor (LLP 0039) say and do — in Slack, in loop panes, and in ground truth
other reconcilers read (PR threads)?

## Decision

<a id="report-relay"></a>**Authority is report + relay.** The mayor answers
fleet questions from re-derived ground truth only (LLP 0002); pushes the
events below; relays explicit human instructions into loop panes (LLP 0034
discipline; the watchdog touches panes on its own judgment to *heal*, the
mayor only on a human request to *steer*); and relays human replies to stuck
reports into PR threads. Every relay confirms back in the event's Slack
thread once submission is verified.

<a id="identity-principle"></a>**Identity principle: authorship, not
transport, decides the marker.** Content the human authored — relayed
verbatim from an allowlisted Slack ID — posts to GitHub **unmarked** (no
`<!-- neutral-… -->` marker) with a plain-prose attribution footer
(`— relayed from Slack`): it *is* the human's comment, and LLP 0027 keys
"human reply" on marker absence, so the relay re-engages a stuck PR and feeds
the words to workers as guidance. Content the **mayor** authors always
carries a marker, per LLP 0026's rule for comments neutral posts. A
marker-signed relay would be a no-op by construction — 0027 would classify it
as neutral's own comment — which makes this a principle, not a style choice.

<a id="push-pull"></a>**Push only what waits on a human; everything else is
pull.** Three push events: a PR flipped ready-for-human-merge (LLP 0019), a
new stuck report (LLP 0026), and a wedge the watchdog failed to heal at both
rungs (LLP 0034 — autonomy ended, so it now waits on the human). Routine
health stays in logs, available by asking. The failed-heal event is
re-derived, never watchdog-reported: still-wedged after ~2 watchdog cadences
means the heal ladder was exhausted (LLP 0002).

<a id="no-irreversible"></a>**No irreversible acts in v1.** The mayor does
not merge, close, or approve. Per RFC 0038 §OQ2 this is deferred on
*protocol*, not authority: a merge command from an allowlisted Slack ID would
be the human's merge (LLP 0019's boundary unmoved, the mayor as the arm), but
irreversible acts require an exact-syntax protocol (e.g. `merge <repo>#<n>`,
never inferred from prose) that is its own future decision LLP.

## Consequences

- LLP 0026's "every comment neutral posts carries a marker" gains the
  authorship refinement above: a verbatim human relay is not a comment
  neutral *authored*. Recorded here; 0026's decided content otherwise stands.
- The Slack channel becomes the second human input surface after GitHub;
  the allowlist (LLP 0040 §allowlist) is what keeps its authority bound to
  the same human LLP 0019 already trusts.
- `@ref LLP 0038 [implements]` — realizes the RFC's authority half.
