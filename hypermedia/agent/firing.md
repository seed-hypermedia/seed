---
name: Firing
summary: A firing is one activation of a trigger, recorded exactly once, with firings of one trigger run one at a time and chains of run-completed triggers stopped as loops after eight hops.
---
**firing**: one activation of a [trigger](../trigger.md). Each firing is recorded exactly once. A chain of run-completed triggers stops as a loop after 8 hops. See [triggers](./triggers.md). <!-- id:rN8IYrE0 -->

# Recorded exactly once

A firing is a row in `trigger_firings` with a unique key `(account, trigger, activityKey)`, so a retried feed page or a repeated schedule tick cannot fire twice. For activity sources, admission is two steps in one transaction: the matcher first inserts a **claim** into `trigger_event_claims` for `(account, trigger, firing key)`, and only a new claim creates the firing row. Claims outlive a Combine (the survivor imports both sets) and are deleted with the trigger. Schedule, webhook, and run-completed firings skip claims and dedupe on the firing row alone. Activity firings use the feed event's identity. Schedule firings use `schedule:<triggerId>:<scheduledAt>`. A [webhook](./webhooks.md) delivery uses the idempotency key its sender supplies. A comment that mentions someone produces two sibling feed events: the comment and a [citation](../protocol/links-and-citations.md). The monitor collapses them onto one key, `blob-<cid>` of the comment version, so a mention fires exactly once, whichever sibling arrives first. <!-- id:WsXEZEwz -->

# Status

A firing's `status` records what happened: <!-- id:gujQ6cpk -->
  - `created`: a thread was started. <!-- id:Hwqa0EPx -->
  - `running`, then `succeeded`: a headless run. <!-- id:6H8HYNJq -->
  - `delivered` or `no-listener`: a wake. <!-- id:TpYQ2W5U -->
  - `error`. <!-- id:E52a_hwj -->
  - `escalated`: a headless run failed and a recovery thread was started. <!-- id:3HgEZVKG -->
  - `running`, then `succeeded` or `failed`: an app trigger's tool call. The firing names the call.

The firing links its `sessionId` when it started a thread and its `runId` when it started a headless run. So `read run:<id>` and the trigger page can show what happened. When a headless script calls `ctx.delegate`, the firing adopts the first child session as its `sessionId`, later children nest under that session, and the first one carries the "Triggered by" context; an escalation re-points the firing at the recovery thread. Deleting a session clears the firing's `sessionId`; deleting an agent deletes its firings and claims. <!-- id:8c75m-cD -->

# One at a time

Firings of one trigger run one at a time: a firing that starts a session waits until the previous firing's run has ended (at most 10 minutes), so two events close together cannot both act on the same state. A turn whose model sends nothing for 8 minutes while no tool runs is ended with an error asking to retry.

There is no cooldown between firings.

# Loop guard

Chains are loop-guarded. A `run-completed` firing is skipped when its ancestry already contains the same trigger within 8 hops, or is deeper than 8 hops at all, so two triggers cannot feed each other forever. The walk follows each firing's `runId`, so only run-completed chains are walkable. <!-- id:mpdiCPIg -->

# See also <!-- id:FbyAsd-M -->

- [Trigger](../trigger.md) <!-- id:E4IJuiwO -->
- [Triggers](./triggers.md) <!-- id:jwAe6dSh -->
- [Webhooks](./webhooks.md)
- [Wake source](./wake-source.md) <!-- id:fah0Pd5N -->
- [Persistence](../operate/persistence.md) <!-- id:8az2SxHN -->
- [Agents glossary](./glossary.md) <!-- id:UFRbrIFi -->
