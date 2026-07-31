# LLP 0053: Channel questions are answered in a thread

**Type:** Decision
**Status:** Active
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-31
**Related:** 0039, 0041, 0042, 0049

## Context

When a human asked a question as a top-level channel message, the mayor
answered with another top-level channel message. With event cards already
minimal (LLP 0049) so the channel reads as a scannable queue, every
question-and-answer pair added two more root messages of conversation to
that queue. Replies under an event root were already threaded; only
channel-root questions leaked answers into the channel.

## Decision

The mayor answers a channel-root question **in a thread on the question
message** (`thread_ts` = the question's `ts`), never as a new channel
message. The channel stays event cards plus the humans' own messages; all
mayor conversation lives in threads. No `reply_broadcast` — the point is a
quiet channel, and Slack notifies the asker of the thread reply anyway.

The unanswered-inbound sweep changes with it: "answered" for a channel-root
message is re-derived from **that message's own thread**
(`conversations.replies`), not from a later mayor message in channel
history — the old predicate would re-answer every already-threaded answer.

## Alternatives rejected

- **Keep answering in channel.** Status quo; buries the waiting-on-you
  queue under conversation, which LLP 0049 minimized the cards to protect.
- **Thread + `reply_broadcast`.** Broadcasting mirrors the reply into the
  channel, recreating the clutter the thread was meant to avoid.

## Consequences

- Threaded questions are unchanged (already answered in their thread).
- Relay confirmations and declines were already threaded; this closes the
  one remaining channel-level mayor reply path.
