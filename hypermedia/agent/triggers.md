---
name: Triggers
summary: "The reference for agent triggers: the sources that fire one, the continuations a firing runs, how monitors match and deduplicate events, and where triggers are edited."
---
A [trigger](./trigger.md) lets an agent act when nobody is talking to it. It binds a **source** to a **continuation**. The source is something that happens: a [comment](../protocol/comments.md), a mention, a [site](../protocol/sites.md) update, a schedule, a webhook delivery, or another [run](./runs.md) finishing. The continuation is what to do about it: start a conversation, wake a [parked](./park.md) run, or run a tool or [script](./script.md) with no model at all. Triggers belong to one agent and live on its agents server. They are the one piece of standing authority an agent holds, so the [security](./security.md) page covers them too. <!-- id:89o2eplg -->

# The data model <!-- id:G5lPmDWS -->

A trigger is a row with a name, an enabled flag, a source, an optional prompt, and an optional continuation. The protocol types are in `agents/protocol/src/index.ts`: <!-- id:x0qddyHJ -->

```ts <!-- id:viN8eyx_ -->
type AgentTriggerInput = {
  name: string
  enabled?: boolean
  source: AgentTriggerSource
  prompt?: string | AgentPromptBlock[]   // required for newThread; a recovery prompt for tool/script
  continuation?: TriggerContinuation     // omitted means newThread
}
```

Prompts accept the same rich Seed [block](../protocol/blocks.md) format as agent system prompts. A plain string is parsed as markdown. Blocks are rendered to markdown before the thread starts. <!-- id:4uU-k5AH -->

## Sources <!-- id:HPNBLtru -->

<!-- id:dzNzPOSx -->
| source <!-- col:rpXTaztr --> | fires when <!-- col:y58r3u6I --> | fields <!-- col:KRwHxbA4 --> <!-- id:JZv2m3xq --> |
| --- | --- | --- |
| `document-comment` | a new comment appears on a resource | `resource`, optional `author` <!-- id:6QPvQAAG --> |
| `user-mention` | a comment or document mentions one of the listed accounts | `mentionedAccounts[]`, optional `resourcePrefix` <!-- id:tQpu4TSH --> |
| `site-update` | new activity appears under a resource prefix | `resourcePrefix`, optional `eventTypes[]` (`doc-update`, `comment`) <!-- id:fyoQw9B_ --> |
| `schedule` | a clock says so | `schedule`: `{kind: 'interval', every, unit}`, `{kind: 'weekly', daysOfWeek, timeOfDay, timezone}`, or `{kind: 'once', runAt, timezone?}` <!-- id:oXlkndG5 --> |
| `webhook` | something POSTs JSON to the trigger's delivery URL | none; the secret is created with the trigger <!-- id:-P02QGwG --> |
| `run-completed` | a run of this account reaches a terminal status | optional `agentId`, `status` (`succeeded`, `failed`, `canceled`), `titleMatch` <!-- id:4JzuZ8WZ --> |

A `user-mention` input still accepts the legacy singular `mentionedAccount` and turns it into the list. An empty list is rejected. Creating an agent with a signing identity also creates an enabled `user-mention` trigger that follows that identity. That is why mentioning an agent's [account](../protocol/identity.md) in a comment summons it. <!-- id:0m8OvinP -->

## Continuations <!-- id:SAHaWbYq -->

<!-- id:_HtUAkvy -->
| kind <!-- col:qqgDTBwN --> | what the firing does <!-- col:Dq0GeKn8 --> | model involved <!-- col:lmflRnlh --> <!-- id:FPjWAF39 --> |
| --- | --- | --- |
| `newThread` (default) | starts a session whose first message is the prompt plus a `<trigger_context>` block; `systemPrompt` adds instructions, `includeAgentSystemPrompt` (default true) can omit the agent's own prompt, `tools` narrows the grants | always <!-- id:9ArI3pSq --> |
| `wake` | delivers `signal` (with optional `payload`) to a run parked on `ctx.waitForEvent`, the same delivery `SignalRun` makes; without `runId` the account's parked runs are searched for one the signal satisfies | never, the run decides <!-- id:c1T1oEj7 --> |
| `tool` | calls one tool headlessly as a journaled workflow run: `read`, `write`, any granted callable, an authored lambda, or an MCP tool | never, unless `onFailure: 'thread'` and it fails <!-- id:Uh5xlgMG --> |
| `script` | runs a workflow module (`export default async function (input, ctx)`) headlessly, with `ctx.input = {event, input, trigger: {id, name, firingId}}` | only if the script calls `ctx.delegate`, or on failure with `onFailure: 'thread'` <!-- id:3vfSy0-V --> |

For `tool`, `input` defaults to the trigger event itself. When you give an `input`, it is a JSON template. String values `"$event"` and `"$event.<path>"` are replaced from the event. For a webhook, the posted JSON is `"$event.payload"`. The tool name is checked when the trigger is written, because a headless firing has nobody to read a "no such tool" error. A `script` is checked by the workflow linter at write time: no `Date`, `Math.random`, timers, `fetch`, or imports, and exactly one default export. It is capped at the workflow source limit. The [journal](./journal.md) and [tool document](./tool-document.md) pages explain the run and the tool it calls. <!-- id:_ju96vTR -->

`onFailure` is `none` or `thread`. With `none` (the default), the error is recorded on the firing and the trigger. With `thread`, the ordinary trigger thread starts with an `automationFailure` block inside its context and an instruction to `read run:<id>` and recover. The prompt is optional for headless kinds. When it is omitted, a default recovery prompt is stored, because the prompt is only used to escalate. <!-- id:Sh0R1Ar4 -->

A common pattern: an agent authors a tool with `write ~/tools/<name>` and wires a webhook to it with `continuation: {kind: 'tool', tool, input: {payload: '$event.payload'}, onFailure: 'thread'}`. From then on, deliveries run its code directly. A model starts only when the code fails. <!-- id:7kDY3C-p -->

# Firing <!-- id:W_1FNPPe -->

Every activation is a [firing](./firing.md). It is a row in `trigger_firings` with a unique key `(account, trigger, activityKey)`, so a retried feed page or a repeated schedule tick cannot fire twice. Activity firings use the feed event's identity. Schedule firings use `schedule:<triggerId>:<scheduledAt>`. A webhook delivery uses its `Idempotency-Key` when the sender supplies one. A comment that mentions someone produces two sibling feed events: the comment and a [citation](../protocol/comments.md). The monitor collapses them onto one key, so a mention fires exactly once, whichever sibling arrives first. <!-- id:WsXEZEwz -->

A firing's `status` records what happened: <!-- id:gujQ6cpk -->
  - `created`: a thread was started. <!-- id:Hwqa0EPx -->
  - `running`, then `succeeded`: a headless run. <!-- id:6H8HYNJq -->
  - `delivered` or `no-listener`: a wake. <!-- id:TpYQ2W5U -->
  - `error`. <!-- id:E52a_hwj -->
  - `escalated`: a headless run failed and a recovery thread was started. <!-- id:3HgEZVKG -->

The firing links its `sessionId` when it started a thread and its `runId` when it started a headless run. So `read run:<id>` and the trigger page can show what happened. <!-- id:8c75m-cD -->

Chains are loop-guarded. A `run-completed` firing is skipped when its ancestry already contains the same trigger within 8 hops, so two triggers cannot feed each other forever. <!-- id:mpdiCPIg -->

# The monitors <!-- id:HV4oYfVQ -->

The **activity monitor** polls the Hypermedia server's activity feed, which is the `ListEvents` request of the [Seed API](../build/web-api.md). The settings are: <!-- id:kVkFZO2M -->
  - `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS`: how often it polls (default 5 seconds). <!-- id:9klo2uSO -->
  - `SEED_AGENTS_ACTIVITY_PAGE_SIZE`: events per page (50). <!-- id:Xa9UInqU -->
  - `SEED_AGENTS_ACTIVITY_MAX_PAGES`: pages per poll (5). <!-- id:bzLCYoSZ -->

It only contacts the feed for accounts that have at least one enabled non-schedule trigger. Each event goes to two consumers through one shared matcher: trigger matching, and any run parked on `ctx.waitForEvent({eventType, resource, author})` for that account. The first poll for an account sets a baseline watermark and only processes events created after the earliest enabled trigger. If the server was down, it backfills for up to one hour and then moves on. Watermarks are durable (`activity_watermarks`), so a restart resumes and does not replay. Polling depends on triggers, so an activity-shaped wait on an account with no enabled activity trigger only ends by timeout. Signal-shaped waits do not depend on polling. <!-- id:nkzChSE8 -->

The **schedule monitor** checks enabled `schedule` triggers on the same interval, records their firings, and disables a `once` trigger after it runs. <!-- id:4faqwRaM -->

The HTTP server delivers **webhooks** synchronously. A request to `POST /agents/api/webhooks/<triggerId>/<secret>`, or to `POST /agents/api/webhooks/<triggerId>` with `Authorization: Bearer <secret>`, with a JSON body answers `202 {accepted, duplicate}`. The body must be `application/json` with no content encoding. The secret is 43 URL-safe characters. It is generated with the trigger and shown on its page to accounts that can edit the agent. The client builds the delivery URL from the server's base. <!-- id:30W5TAHJ -->

**Run-completed** fires inline when a run is finalized. There is no polling. <!-- id:KKT9w-mu -->

A trigger thread is a normal session with `origin: 'trigger'`. It carries an `AgentSessionTriggerContext` (trigger, firing, activity summary, the full event). The UI renders it as a context card and the model sees it as `<trigger_context>`. Trigger and headless runs dispatch on the background queue with `maxAttempts: 1`, so a failed firing is not retried automatically. The [operations](./operations.md) page describes the queue. <!-- id:4m4FD6FE -->

# Working with triggers <!-- id:mTG59Yfj -->

## In the Seed app <!-- id:jvEv2j0H -->

The agent page's **Triggers** tab lists triggers. Each one opens in an editable detail view with: <!-- id:zchsSkup -->
  - name and enabled toggle <!-- id:hgkjPBKI -->
  - the source and its form: document autocomplete for comment triggers, account and site autocomplete for mention and site-update triggers, and interval, weekly, and one-time schedule forms <!-- id:JJha9v1A -->
  - the prompt in the block editor <!-- id:anUmCwS4 -->
  - a **When it fires** selector for the continuation, with a tool picker fed by the agent's tools, a JSON input template, a script editor, a signal field for `wake`, and the on-failure toggle <!-- id:CdsHU--l -->
  - operational metadata: created, updated, last checked, last fired, last error <!-- id:VMDh9Iw3 -->
  - **Recent firings** with status, event summary, error, a link to the thread, and an inline run card for headless runs <!-- id:XHZ8P3WK -->

Every edit autosaves. The list refreshes live from `trigger-updated` account events, so triggers an agent creates for itself appear at once. The [desktop and web UI](./desktop-ui.md) page covers the other screens. <!-- id:Bwq9P3yn -->

## The agent itself <!-- id:bBRPFDh1 -->

An agent manages its own triggers with the [read](./read.md) and [write](./write.md) verbs: <!-- id:KA4JCbvJ -->
  - `read ~/triggers/` lists them, with the write contract inline. <!-- id:BdwUYPMG -->
  - `read ~/triggers/<name>` returns one trigger with its recent firings. <!-- id:fB7qLr6W -->
  - `write ~/triggers/<name>` creates, edits, enables, disables, or deletes by name (or id), and honours `enabled` as written. <!-- id:PqNfXf2G -->

The [Space index](./space-index.md) always advertises this, so an agent can complete "do this every morning" in one turn. There is no consent step. The owner decided on 2026-08-19 that agents manage their own triggers directly. The [security](./security.md) page records what that means for the threat model. <!-- id:j1HGdgrc -->

## Signed API <!-- id:6JaK_oUF -->

There are five actions, all scoped to the account through the owning agent: <!-- id:32igKmQg -->
  - `ListAgentTriggers {agentId}` <!-- id:LTDaOlak -->
  - `GetAgentTrigger {triggerId}`: returns the trigger, its sessions, up to 25 most recent firings, and `webhookSecret` for editors. <!-- id:5sWdcAKU -->
  - `CreateAgentTrigger {agentId, trigger, clientRequestId?}` <!-- id:UNaF32tJ -->
  - `UpdateAgentTrigger {triggerId, patch}` <!-- id:f18H8tDf -->
  - `DeleteAgentTrigger {triggerId}` <!-- id:LgMQdOP3 -->

Deleting a trigger detaches its runs and removes its firings. Sessions it created are kept. Details are in the [signed API](./signed-api.md). <!-- id:JMPdcC4g -->

## Tests and tooling <!-- id:rrtBKYP9 -->

`bun run test:trigger` in `agents/` boots the real daemon against a local stand-in for the activity feed. It creates an agent and a mention trigger over the signed API and asserts that a comment mention fires exactly one session. The unit suites are `activity-triggers.test.ts`, `trigger-events.test.ts`, `activity-trigger-race.test.ts`, and `schedule-triggers.test.ts`. <!-- id:fnvnd4yo -->

# Where this is going <!-- id:LOPg6RLL -->

As of September 2026, triggers are SQLite rows edited through CRUD actions and the `~/triggers/` verb surface. The [roadmap](./roadmap.md) records the plan: trigger **documents**, content-addressed like `~/tools/` and versioned by CID, replacing the CRUD actions, with a `document-change` source and an `appendTo` continuation. None of that is built. The `agent_triggers` table also has a `cooldown_ms` column that nothing reads or writes. There is no cooldown feature. <!-- id:7AfhhSIj -->

# See also <!-- id:aqgk0ha- -->

- [trigger](./trigger.md) and [firing](./firing.md), the term pages. <!-- id:5xLIJVIG -->
- [Trigger continuations](./trigger-continuations.md), the dated record of when headless continuations shipped. <!-- id:dRNNJ0yv -->
- [park and wait](./park.md) and [wake source](./wake-source.md), for the runs a `wake` continuation reaches. <!-- id:KzpZ9_1r -->
- [Persistence](./persistence.md) for the `agent_triggers`, `trigger_firings`, and `activity_watermarks` tables. <!-- id:iGyU4fg4 -->
- [Operations](./operations.md) for the monitor configuration and the run queue. <!-- id:wUmHU66d -->
- [Agents glossary](./glossary.md) for every agent term. <!-- id:Bm3zr_cA -->
