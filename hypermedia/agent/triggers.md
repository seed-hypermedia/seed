---
name: Triggers
summary: The reference for agent triggers: the six sources that can fire, the four continuations a firing can run, how the monitors match and deduplicate, and where triggers are edited.
---
A trigger lets an agent act when nobody is talking to it. It binds a **source** (something that happens: a comment, a mention, a site update, a schedule, a webhook delivery, or another run finishing) to a **continuation** (what to do about it: start a conversation, wake a parked run, or run a tool or script with no model at all). Triggers belong to one agent, live on its agents server, and are the one piece of standing authority an agent holds, so the [security](./security.md) page discusses them too.

# The data model

A trigger is a row with a name, an enabled flag, a source, an optional prompt, and an optional continuation. The protocol types are in `agents/protocol/src/index.ts`:

```ts
type AgentTriggerInput = {
  name: string
  enabled?: boolean
  source: AgentTriggerSource
  prompt?: string | AgentPromptBlock[]   // required for newThread; a recovery prompt for tool/script
  continuation?: TriggerContinuation     // omitted means newThread
}
```

Prompts accept the same rich Seed block format as agent system prompts; a plain string is parsed as markdown, and blocks are rendered to markdown before the thread starts.

## Sources

| source | fires when | fields |
| --- | --- | --- |
| `document-comment` | a new comment appears on a resource | `resource`, optional `author` |
| `user-mention` | a comment or document mentions one of the listed accounts | `mentionedAccounts[]`, optional `resourcePrefix` |
| `site-update` | new activity appears under a resource prefix | `resourcePrefix`, optional `eventTypes[]` (`doc-update`, `comment`) |
| `schedule` | a clock says so | `schedule`: `{kind: 'interval', every, unit}`, `{kind: 'weekly', daysOfWeek, timeOfDay, timezone}`, or `{kind: 'once', runAt, timezone?}` |
| `webhook` | something POSTs JSON to the trigger's delivery URL | none; the secret is created with the trigger |
| `run-completed` | a run of this account reaches a terminal status | optional `agentId`, `status` (`succeeded`, `failed`, `canceled`), `titleMatch` |

A `user-mention` input still accepts a legacy singular `mentionedAccount` and normalizes it into the list; an empty list is rejected. Creating an agent with a signing identity auto-creates an enabled `user-mention` trigger following that identity, which is why mentioning an agent's account in a comment summons it.

## Continuations

| kind | what the firing does | model involved |
| --- | --- | --- |
| `newThread` (default) | starts a session whose first message is the prompt plus a `<trigger_context>` block; `systemPrompt` adds instructions, `includeAgentSystemPrompt` (default true) can omit the agent's own prompt, `tools` narrows the grants | always |
| `wake` | delivers `signal` (with optional `payload`) to a run parked on `ctx.waitForEvent`, the same delivery `SignalRun` makes; without `runId` the account's parked runs are searched for one the signal satisfies | never, the run decides |
| `tool` | calls one tool headlessly as a journaled workflow run: `read`, `write`, any granted callable, an authored lambda, or an MCP tool | never, unless `onFailure: 'thread'` and it fails |
| `script` | runs a workflow module (`export default async function (input, ctx)`) headlessly, with `ctx.input = {event, input, trigger: {id, name, firingId}}` | only if the script calls `ctx.delegate`, or on failure with `onFailure: 'thread'` |

For `tool`, `input` defaults to the trigger event itself. When given, it is a JSON template whose string values `"$event"` and `"$event.<path>"` are replaced from the event; for a webhook the posted JSON is `"$event.payload"`. The tool name is checked when the trigger is written, because a headless firing has nobody to read a "no such tool" error. A `script` is linted with the workflow linter at write time (no `Date`, `Math.random`, timers, `fetch`, or imports; exactly one default export) and capped at the workflow source limit.

`onFailure` is `none` (default: the error is recorded on the firing and the trigger) or `thread`: the ordinary trigger thread starts with an `automationFailure` block inside its context and an instruction to `read run:<id>` and recover. The prompt is optional for headless kinds; when omitted a default recovery prompt is stored, since the prompt is only used to escalate.

The pattern this enables: an agent authors a tool with `write ~/tools/<name>`, wires a webhook to it with `continuation: {kind: 'tool', tool, input: {payload: '$event.payload'}, onFailure: 'thread'}`, and from then on deliveries run its code directly. A model is only spun up when the code fails.

# Firing

Every activation is a **firing**: a row in `trigger_firings` keyed by `(account, trigger, activityKey)`, unique, so a retried feed page or a repeated schedule tick cannot fire twice. Activity firings use the feed event's identity; schedule firings use `schedule:<triggerId>:<scheduledAt>`; a webhook delivery uses its `Idempotency-Key` when the sender supplies one. A comment that mentions someone produces two sibling feed events (the comment and a citation), and the monitor collapses them onto one key so a mention fires exactly once whichever sibling arrives first.

A firing's `status` tells its story: `created` (a thread was started), `running` then `succeeded` (a headless run), `delivered` or `no-listener` (a wake), `error`, or `escalated` (a headless run failed and a recovery thread was started). The firing links its `sessionId` when it started a thread and its `runId` when it started a headless run, so `read run:<id>` and the trigger page can show what happened.

Chains are loop-guarded: a `run-completed` firing whose ancestry already contains the same trigger within 8 hops is skipped, so two triggers cannot feed each other forever.

# The monitors

The **activity monitor** polls the Hypermedia server's activity feed (the `ListEvents` request of the [Seed API](../build/web-api.md)) every `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` (default 5 seconds), fetching up to `SEED_AGENTS_ACTIVITY_PAGE_SIZE` (50) events per page and `SEED_AGENTS_ACTIVITY_MAX_PAGES` (5) pages per poll. It only contacts the feed for accounts that have at least one enabled non-schedule trigger. Each event is offered to two consumers: trigger matching, and any run parked on `ctx.waitForEvent({eventType, resource, author})` for that account, through one shared matcher. The first poll for an account establishes a baseline watermark and only processes events created after the earliest enabled trigger; if the server was down, it backfills for up to one hour and then advances. Watermarks are durable (`activity_watermarks`), so a restart resumes rather than replays. Because polling is gated on triggers, an activity-shaped wait on an account with no enabled activity trigger only ever resolves by timeout; signal-shaped waits do not depend on polling.

The **schedule monitor** evaluates enabled `schedule` triggers on the same interval, records their firings, and disables a `once` trigger after it has run.

**Webhooks** are delivered synchronously by the HTTP server: `POST /agents/api/webhooks/<triggerId>/<secret>` (or `POST /agents/api/webhooks/<triggerId>` with `Authorization: Bearer <secret>`) with a JSON body answers `202 {accepted, duplicate}`. The body must be `application/json` with no content encoding; the secret is 43 URL-safe characters, generated with the trigger and shown on its page to accounts that can edit the agent. The delivery URL is built by the client from the server's base.

**Run-completed** fires inline when a run is finalized; there is no polling.

A trigger thread is a normal session with `origin: 'trigger'`, carrying an `AgentSessionTriggerContext` (trigger, firing, activity summary, the full event) that the UI renders as a context card and the model sees as `<trigger_context>`. Trigger and headless runs dispatch on the background queue with `maxAttempts: 1`, so a failed firing is not retried automatically; the [operations](./operations.md) page describes the queue.

# Working with triggers

## In the Seed app

The agent page's **Triggers** tab lists triggers and opens each in an editable detail view: name, enabled toggle, source and its per-type form (document autocomplete for comment triggers, account and site autocomplete for mention and site-update triggers, interval, weekly, and one-time schedule forms), the prompt in the block editor, a **When it fires** selector for the continuation (with a tool picker fed by the agent's tools, a JSON input template, a script editor, a signal field for `wake`, and the on-failure toggle), operational metadata (created, updated, last checked, last fired, last error), and **Recent firings** with status, event summary, error, a link to the thread, and an inline run card for headless runs. Every edit autosaves. The list refreshes live from `trigger-updated` account events, so triggers an agent creates for itself appear immediately. The [desktop and web UI](./desktop-ui.md) page has the rest of the screens.

## The agent itself

An agent manages its own triggers through the verbs: `read ~/triggers/` lists them with the write contract inline, `read ~/triggers/<name>` returns one trigger with its recent firings, and `write ~/triggers/<name>` creates, edits, enables, disables, or deletes by name (or id), honouring `enabled` as written. The Space index always advertises this affordance, so "do this every morning" is a request an agent can complete in one turn. There is no consent step; the owner decided (2026-08-19) that agents manage their own triggers directly, and the [security](./security.md) page records what that means for the threat model.

## Signed API

Five actions, all account-scoped through the owning agent: `ListAgentTriggers {agentId}`, `GetAgentTrigger {triggerId}` (returns the trigger, its sessions, up to 25 most recent firings, and `webhookSecret` for editors), `CreateAgentTrigger {agentId, trigger, clientRequestId?}`, `UpdateAgentTrigger {triggerId, patch}`, and `DeleteAgentTrigger {triggerId}`. Deleting a trigger detaches its runs and removes its firings; sessions it created are kept. Details in the [signed API](./signed-api.md).

## Tests and tooling

`bun run test:trigger` in `agents/` boots the real daemon against a local stand-in for the activity feed, creates an agent and a mention trigger over the signed API, and asserts that a comment mention fires exactly one session. The unit suites are `activity-triggers.test.ts`, `trigger-events.test.ts`, `activity-trigger-race.test.ts`, and `schedule-triggers.test.ts`.

# Where this is going

As of September 2026, triggers are SQLite rows edited through CRUD actions and the `~/triggers/` verb surface. The direction recorded in the [roadmap](./roadmap.md) is trigger **documents**: content-addressed like `~/tools/`, versioned by CID, replacing the CRUD actions, with a `document-change` source and an `appendTo` continuation. None of that is built. The `agent_triggers` table also carries a `cooldown_ms` column that nothing reads or writes; there is no cooldown feature.

# See also

- [trigger](./trigger.md) and [firing](./firing.md), the term pages.
- [Trigger continuations](./trigger-continuations.md), the dated record of when headless continuations shipped.
- [Persistence](./persistence.md) for the `agent_triggers`, `trigger_firings`, and `activity_watermarks` tables.
- [Operations](./operations.md) for the monitor configuration and the run queue.
