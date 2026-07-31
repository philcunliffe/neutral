# LLP 0054: Ready-to-merge detail replies are one line

**Type:** Decision
**Status:** Active
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-31
**Related:** 0019, 0046, 0049, 0050

## Context

LLP 0049 moved event depth off the card and into the thread, and the
detail reply inherited LLP 0046's "answer-ready body" — state, what it
needs, links, what a reply does. For `ready-to-merge` events that body
grew into a multi-paragraph brief (what the PR does, diff stats, a
re-derived merge-order narrative), observed in production on
hyparam/hypaware#522 (2026-07-31). A mergeable PR is the *good* case —
the human's next act is one click — and the long brief buried that.

## Decision

The `ready-to-merge` detail reply is **one line** plus the event key
line, nothing else:

```
🟢 <github-link|repo#n> ready to merge at <short-sha> — reply here to comment on the PR.
[neutral <owner/repo>#<n> ready-to-merge@<sha>]
```

The card already says what the PR is and carries any ⚠️ merge-order
warning (LLP 0049 §card-shape, LLP 0050); depth beyond that is available
by asking in the thread. Other events (`stuck`, `unhealed`, …) keep the
answer-ready body — there the human must understand a problem, not click
a button.

## Alternatives rejected

- **Keep the answer-ready body for all events.** Status quo; the merge
  case pays a reading cost with no decision to inform.
- **One line but fold merge-order prose in when complicated.** The ⚠️
  warning on the card is already the re-derived merge-order surface;
  duplicating it in the reply re-creates the drift 0050 removed.

## Consequences

- Merge notifications scan in one glance in channel (the reply still
  `reply_broadcast`s) and in thread.
- A human wanting the why of a warning asks in the thread and gets a
  ground-truth answer at that moment, not a stale brief.
