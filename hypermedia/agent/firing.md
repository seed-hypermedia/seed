---
name: Firing
summary: A firing is one time a trigger goes off, and the server records it exactly once, runs session firings of one trigger one at a time, and stops chains of run-completed triggers after eight hops.
---
A **firing** is one time a [trigger](../trigger.md) goes off. For example, an hourly trigger has 24 firings a day. The server records each firing exactly once, so one event never starts the same work twice. <!-- id:rN8IYrE0 -->

This page explains how the server does that, what a firing's status means, and how loops are stopped. It applies to both forms of trigger: trigger [documents](../protocol/documents.md) and triggers stored on an [agent](../agent.md)'s server. The [trigger reference](./triggers.md) has the sources and continuations.

# Recorded exactly once

A firing is a row in `trigger_firings` with a unique key `(account, trigger, activityKey)`. So a feed page that is read twice, or a schedule tick that repeats, cannot fire twice. <!-- id:WsXEZEwz -->

The key depends on the source:

| Source | Key |
| --- | --- |
| an activity source | the feed event's identity |
| `schedule` | `schedule:<triggerId>:<scheduledAt>` |
| `webhook` | `webhook:<key>`, where the key is the idempotency key the sender supplies. Without one, each delivery gets a new key. See [webhooks](./webhooks.md) |

For activity sources, the server admits an event in two steps inside one transaction. The matcher first inserts a **claim** into `trigger_event_claims` for `(account, trigger, firing key)`. Only a new claim creates the firing row. Claims survive a Combine, because the trigger that stays imports both sets. Claims are deleted with the trigger. Schedule, webhook and run-completed firings use no claims. The unique firing row alone stops a repeat.

A [comment](../protocol/comments.md) that mentions someone produces two feed events: the comment and a [citation](../protocol/links-and-citations.md). The monitor gives both the same key, `blob-<cid>` of the comment version. So a mention fires exactly once, whichever of the two arrives first.

# Status

A firing's `status` field records what happened: <!-- id:gujQ6cpk -->
  - `created`: a thread (a [session](./session.md)) was started. <!-- id:Hwqa0EPx -->
  - `running`, then `succeeded`: a headless run, which is a [run](./runs.md) with no model. <!-- id:6H8HYNJq -->
  - `delivered` or `no-listener`: a wake. <!-- id:TpYQ2W5U -->
  - `error`. <!-- id:E52a_hwj -->
  - `escalated`: a headless run failed and a recovery thread was started. <!-- id:3HgEZVKG -->
  - `running`, then `succeeded` or `failed`: an app trigger's tool call. The firing names the call.

The firing links its `sessionId` when it started a thread, and its `runId` when it started a headless run. So `read run:<id>` and the trigger page can show what happened. <!-- id:8c75m-cD -->

- When a headless script calls `ctx.delegate`, the firing takes the first child session as its `sessionId`. Later children nest under that session. The first one carries the "Triggered by" context.
- An escalation points the firing at the recovery thread instead.
- Deleting a session clears the firing's `sessionId`.
- Deleting an agent deletes its firings and claims.

# One at a time

Firings of one trigger that start a session run one at a time. So two events close together cannot both act on the same state.

- Each firing waits until the run of the one before has ended, for at most 10 minutes. After 10 minutes it starts anyway.
- Up to three firings can wait. A fourth starts at once.
- Firings that call a tool or run a script do not wait. An app's trigger always calls a tool, so its firings never wait.

There is no required pause between firings.

# Loop guard

The server stops chains that loop. It skips a `run-completed` firing in two cases: the chain of firings that led to it already contains the same trigger within 8 hops, or the chain is deeper than 8 hops. So two triggers cannot feed each other forever. The server follows each firing's `runId` to walk the chain, so it can only walk run-completed chains. <!-- id:mpdiCPIg -->

# See also <!-- id:FbyAsd-M -->

- [Trigger](../trigger.md) <!-- id:E4IJuiwO -->
- [Triggers](./triggers.md) <!-- id:jwAe6dSh -->
- [Webhooks](./webhooks.md)
- [Wake source](./wake-source.md) <!-- id:fah0Pd5N -->
- [Persistence](../operate/persistence.md) <!-- id:8az2SxHN -->
- [Agents glossary](./glossary.md) <!-- id:UFRbrIFi -->
