# LLP 0056: Thread replies never broadcast to the channel

**Type:** Decision
**Status:** Active
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-31
**Related:** 0044, 0049, 0053, 0054

## Context

LLP 0049 kept `reply_broadcast: true` on event detail replies so a new
event on an already-rooted artifact still pushed to the channel. In
practice the broadcasts re-created the clutter the minimal cards (0049)
and threaded answers (0053) removed: every re-approval or state change
mirrored a thread reply into the channel. The human asked for thread
replies to stay out of the channel entirely.

## Decision

**No mayor thread reply ever sets `reply_broadcast`.** The channel is
root cards and the humans' own messages, nothing else. A new event on an
existing root is a card update (silent), a re-pin (silent — the pin list
is the waiting-on-you queue, LLP 0044), and a plain thread reply.

The accepted tradeoff: channel-level notification for a recurring event
is gone; thread followers still get Slack's thread notification, and the
pin + card carry the state for everyone else. If that proves too quiet,
the escalation is an explicit `@mention` inside the thread reply — a
future decision, not a return to broadcast.

## Alternatives rejected

- **Keep broadcast (status quo, 0049).** Exactly the channel noise the
  human asked to remove; a broadcast is a channel post wearing a thread
  costume.
- **Broadcast only for `ready-to-merge`.** Merge events are the most
  frequent recurrence — the common case would still clutter the channel.

## Consequences

- LLP 0049's detail-reply clause and LLP 0054's "still broadcasts"
  consequence gain forward-refs here.
- A human who unpins nothing and follows no threads sees only new-artifact
  cards; the canvas and pin queue are the catch-up surfaces.
