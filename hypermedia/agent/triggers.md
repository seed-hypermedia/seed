---
name: Triggers
summary: "The reference for triggers: the nine sources that fire one, the continuations a firing runs, the form a trigger document stores, how the monitors match events, and the three ways to edit triggers."
---
A [trigger](../trigger.md) lets an [agent](../agent.md) or an [app](../app.md) act when nobody is talking to it. It binds a **source** to a **continuation**. The source is something that happens: a [comment](../protocol/comments.md), a mention, a reply, a comment on a document the agent's account wrote, a [site](../protocol/sites.md) update, any list of those as alternative **conditions**, a schedule, a webhook delivery, or another [run](./runs.md) finishing. The continuation is what to do about it: start a conversation, wake a [parked](./park.md) run, or run a tool or [script](./script.md) with no model at all. This page is the reference: the shapes, the matching and the actions. [Trigger](../trigger.md) explains the concept, and how a trigger document relates to the row the [app environment](../software/app-environment.md) fires from. Triggers are the one piece of standing authority an agent holds, so the [security](./security.md) page covers them too. <!-- id:89o2eplg -->

# The data model <!-- id:G5lPmDWS -->

On the server, a trigger is a row with a name, an enabled flag, a source, an optional prompt, and an optional continuation. The protocol types are in `apps/protocol/src/index.ts`: <!-- id:x0qddyHJ -->

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

A trigger that is a document has the same source, and its `tool`, `input` and body become the continuation and the prompt: a `tool` continuation when it names a tool, otherwise the default `newThread` with the body as the prompt. The row also records the document's id, the version it was read from and its author.

## Sources <!-- id:HPNBLtru -->

There are nine source types: the five activity sources, `activity` (a list of them), `schedule`, `webhook` and `run-completed`.

<!-- id:dzNzPOSx -->
| source <!-- col:rpXTaztr --> | fires when <!-- col:y58r3u6I --> | fields <!-- col:KRwHxbA4 --> <!-- id:JZv2m3xq --> |
| --- | --- | --- |
| `document-comment` | a new comment appears on a resource | `resource`, optional `author` <!-- id:6QPvQAAG --> |
| `user-mention` | a comment or document mentions one of the listed accounts, including a document attribute such as `owner` set to one of them | `mentionedAccounts[]`, optional `resourcePrefix` <!-- id:tQpu4TSH --> |
| `comment-reply` | a comment replies directly to a comment by one of the listed accounts; an account's reply to itself never matches | `repliedToAccounts[]`, optional `resourcePrefix` <!-- id:jlCK6tbO --> |
| `document-author-comment` | a comment appears on a document one of the listed accounts authored; the author's own comments never match | `documentAuthors[]`, optional `resourcePrefix` <!-- id:mf2zxBhI --> |
| `site-update` | new activity appears under a resource prefix; activity the trigger's own agent authored (signed by one of its signing identities) never matches unless `includeOwnActivity` is true, so an agent writing or commenting under a prefix it watches does not start itself again | `resourcePrefix`, optional `eventTypes[]` (`doc-update`, `comment`), optional `includeOwnActivity` <!-- id:fyoQw9B_ --> |
| `activity` | any one of its conditions matches; the event fires the trigger once however many conditions match | `conditions[]`, each `{id, source}` where `source` is one of the four activity sources above <!-- id:awQJs1x6 --> |
| `schedule` | a clock says so | `schedule`: `{kind: 'interval', every, unit}`, `{kind: 'weekly', daysOfWeek, timeOfDay, timesOfDay?, timezone}` (`timesOfDay` lists several times a day), or `{kind: 'once', runAt, timezone?}` <!-- id:oXlkndG5 --> |
| `webhook` | something POSTs JSON to the trigger's delivery URL | none; the secret is created with the trigger. See [webhooks](./webhooks.md) <!-- id:-P02QGwG --> |
| `run-completed` | a run of this account reaches a terminal status | optional `agentId`, `status` (`succeeded`, `failed`, `canceled`), `titleMatch` <!-- id:4JzuZ8WZ --> |

An empty account list is rejected. Creating an agent with a signing identity also creates one enabled `activity` trigger, named "Mentions, replies, and comments for \<agent>", with three conditions on the account `self`: a `user-mention`, a `comment-reply`, and a `document-author-comment`. In those three sources `self` means whichever accounts the agent signs as when an event arrives, so the trigger follows a new primary account; a stored trigger published as a document has the agent's own account ids turned into `self`. That is why mentioning an agent's [account](../protocol/identity.md) in a comment, replying to it, or commenting on a document it published summons it. <!-- id:0m8OvinP -->

Each condition of an `activity` trigger has a stable `id`. A firing records which conditions matched (`matchedConditions`), and a session the firing started shows them. Two triggers can be merged into one with `CombineAgentTriggers`: the survivor takes the union of both condition lists, keeps both histories and deduplication claims, and the other is retired with `mergedInto` set; a retired trigger cannot be edited or re-enabled. `UpdateAgentTrigger` accepts an `expectedUpdatedAt` so two editors cannot silently overwrite each other. <!-- id:2RZmc9Te -->

A trigger cannot change between a webhook source and any other source. Make a new trigger instead.

## Continuations <!-- id:SAHaWbYq -->

<!-- id:_HtUAkvy -->
| kind <!-- col:qqgDTBwN --> | what the firing does <!-- col:Dq0GeKn8 --> | model involved <!-- col:lmflRnlh --> <!-- id:FPjWAF39 --> |
| --- | --- | --- |
| `newThread` (default) | starts a session whose first message is the prompt plus a `<trigger_context>` block; `systemPrompt` adds instructions, `includeAgentSystemPrompt` (default true) can omit the agent's own prompt, `tools` narrows the grants | always <!-- id:9ArI3pSq --> |
| `wake` | delivers `signal` (with optional `payload`) to a run parked on `ctx.waitForEvent`, the same delivery `SignalRun` makes; without `runId` the account's parked runs are searched for one the signal satisfies | never, the run decides <!-- id:c1T1oEj7 --> |
| `tool` | calls one tool headlessly as a journaled workflow run: `read`, `write`, any granted callable (a builtin or an MCP tool), or a [tool](../tool.md) by its hm:// URL | never, unless `onFailure: 'thread'` and it fails <!-- id:Uh5xlgMG --> |
| `script` | runs a workflow module (`export default async function (input, ctx)`) headlessly, with `ctx.input = {event, input, trigger: {id, name, firingId}}` | only if the script calls `ctx.delegate`, or on failure with `onFailure: 'thread'` <!-- id:3vfSy0-V --> |

For `tool`, `input` defaults to the trigger event itself. When you give an `input`, it is a JSON template. String values `"$event"` and `"$event.<path>"` are replaced from the event. For a webhook, the posted JSON is `"$event.payload"`. The tool name is checked when the trigger is written, because a headless firing has nobody to read a "no such tool" error. A `script` is checked by the workflow linter at write time: no `Date`, `Math.random`, timers, `fetch`, or imports, and exactly one default export. It is capped at the workflow source limit. The [journal](./journal.md) and [tool document](./tool-document.md) pages explain the run and the tool it calls. <!-- id:_ju96vTR -->

`onFailure` is `none` or `thread`. With `none` (the default), the error is recorded on the firing and the trigger. With `thread`, the ordinary trigger thread starts with an `automationFailure` block inside its context and an instruction to `read run:<id>` and recover. The prompt is optional for headless kinds. When it is omitted, a default recovery prompt is stored, because the prompt is only used to escalate. <!-- id:Sh0R1Ar4 -->

A trigger document expresses two of these: a `tool` continuation that calls a tool of its own host by hm:// URL, and a plain `newThread` (no `systemPrompt`, no narrowed `tools`, the agent's own prompt included). Every other continuation exists only on a trigger kept on the server. See [the document and the server](../trigger.md).

## The document form

A trigger document stores its source and input template as nested [metadata](../metadata.md) attributes. Document attributes merge key by key and a list is one value replaced whole (see [how concurrent edits resolve](../protocol/documents.md)), so the source keeps its sets as maps, one key per entry: `daysOfWeek: {mon: true, fri: true}`, `timesOfDay: {"08:00": true}`, `mentionedAccounts`, `repliedToAccounts` and `documentAuthors` as `{<account or self>: true}`, `eventTypes: {comment: true}`, and `conditions` keyed by each condition's id. Turning one day off is then a change to one key, and two people editing different entries both keep theirs. The trigger engine works with lists; `triggerSourceToMetadata` / `triggerSourceFromMetadata` in `@seed-hypermedia/client/apps` convert at the document boundary. Writing a whole `source` or `input` clears it first, then sets each entry, so nothing from the old shape remains.

# Firing <!-- id:W_1FNPPe -->

Every activation is a [firing](./firing.md), a row in `trigger_firings` with a unique key, so one event fires a trigger once. Firings of one trigger run one at a time, and chains of run-completed triggers stop after 8 hops. The firing page has the keys, the statuses and the loop guard.

# The monitors <!-- id:HV4oYfVQ -->

The **activity monitor** polls the Hypermedia server's activity feed, which is the `ListEvents` request of the [Seed API](../build/web-api.md). The settings are: <!-- id:kVkFZO2M -->
  - `SEED_APPS_ACTIVITY_POLL_INTERVAL_MS`: how often it polls (default 5 seconds). <!-- id:9klo2uSO -->
  - `SEED_APPS_ACTIVITY_PAGE_SIZE`: events per page (50). <!-- id:Xa9UInqU -->
  - `SEED_APPS_ACTIVITY_MAX_PAGES`: pages per poll (5). <!-- id:bzLCYoSZ -->

It only contacts the feed for accounts that have at least one enabled non-schedule trigger (webhook and run-completed triggers keep polling alive too). Each event goes to two consumers through one shared matcher: trigger matching, and any run parked on `ctx.waitForEvent({eventType, resource, author})` for that account. The feed is requested in **observed** order, so a blob that propagated late surfaces at the top when it arrives. An event is new when its key is not in the account's watermark, a ring of the most recently seen keys; its create time does not matter, so a comment that reaches the server hours after it was written still fires when first seen. The one time-based filter is the cold start: the first poll for an account only admits events created after its earliest enabled trigger. The watermark advances after each firing is durably recorded and is itself durable (`activity_watermarks`), so a restart resumes from the last handled event and does not replay. Polling depends on triggers, so an activity-shaped wait on an account with no enabled activity trigger only ends by timeout. Signal-shaped waits do not depend on polling. <!-- id:nkzChSE8 -->

The **schedule monitor** checks enabled `schedule` triggers on the same interval, records their firings, and disables a `once` trigger at fire time, before its run starts. <!-- id:4faqwRaM -->

The HTTP server delivers **webhooks** synchronously, with no polling. [Webhooks](./webhooks.md) has the delivery URL, the secret and the responses.

**Run-completed** fires inline when a run is finalized. There is no polling. <!-- id:KKT9w-mu -->

A trigger thread is a normal session whose first [run](./runs.md) has `origin: 'trigger'` (origin is a property of the run, not the session). The session carries `startedByTrigger`, an `AgentSessionTriggerContext` snapshot taken at firing time: the trigger, the firing, the activity summary, the full event, the conditions that matched, the prompt as it was then, and the firing's status and error. Later edits to the trigger do not rewrite it. The UI renders it as a context card and the model sees it as `<trigger_context>`. Trigger runs dispatch on the background queue. A background agent run is attempted up to three times, so a firing that fails on a flaky provider is retried before it is recorded as failed. The [operations](../operate/run-queue.md) page describes the queue. <!-- id:4m4FD6FE -->

# Working with triggers <!-- id:mTG59Yfj -->

There are three ways to edit triggers: the Seed app, the agent itself, and the signed API. In each, a trigger that is a document is changed by publishing a new version of the document, and the actions that edit rows refuse it and name the document.

## In the Seed app <!-- id:jvEv2j0H -->

The agent page's **Triggers** tab lists triggers. Each one opens in an editable detail view with: <!-- id:zchsSkup -->
  - name and enabled toggle <!-- id:hgkjPBKI -->
  - the source and its form: a **When any of these happen** list of conditions with **Add condition** and a per-condition type menu (mention, reply to account, comment on account's document, comment on a document, site update), document autocomplete for comment conditions, account and site autocomplete, and interval, weekly, and one-time schedule forms; run-completed is shown only on triggers that already use it <!-- id:JJha9v1A -->
  - the prompt in the block editor <!-- id:anUmCwS4 -->
  - the continuation choice: **Start a thread (model handles it)**, **Call a tool (no model)**, **Run a script (no model)**, or **Wake a parked run**, with a tool picker fed by the agent's tools, a JSON input template, a script editor, a signal field for `wake`, and the on-failure toggle <!-- id:CdsHU--l -->
  - **Combine with another trigger**, and a **Combined** badge on a retired trigger <!-- id:VdlOvvV9 -->
  - operational metadata: created, updated, last checked, last fired, last error <!-- id:VMDh9Iw3 -->
  - **Firings** with status, event summary, error, a link to the thread, and an inline run card for headless runs <!-- id:XHZ8P3WK -->

Every edit autosaves. The list refreshes live from `trigger-updated` account events, so triggers an agent creates for itself appear at once. The [desktop and web UI](./in-the-app.md) page covers the other screens. <!-- id:Bwq9P3yn -->

Apps have a **Triggers** tab too, and a trigger document opens inside its host. [Building an app](../build/building-an-app.md) walks through making one.

## The agent itself <!-- id:bBRPFDh1 -->

An agent manages its own triggers with the [read](./read.md) and [write](./write.md) verbs: <!-- id:KA4JCbvJ -->
  - `read ~/triggers/` lists them, with the write contract inline. <!-- id:BdwUYPMG -->
  - `read ~/triggers/<name>` returns one trigger with its five most recent firings. <!-- id:fB7qLr6W -->
  - `write ~/triggers/<name>` creates, edits, enables, disables, or deletes by name (or id), and honours `enabled` as written. <!-- id:PqNfXf2G -->
  - `write hm://<account>/<agent or app path>/<name>` with `options.trigger` publishes a trigger document. An agent that already publishes trigger documents must use this for every trigger a document can express; `~/triggers/<name>` then takes only the rest.

The [Space index](./space-index.md) always advertises this, so an agent can complete "do this every morning" in one turn. There is no consent step: agents manage their own triggers directly. The [security](./security.md) page records what that means for the threat model. <!-- id:j1HGdgrc -->

## Signed API <!-- id:6JaK_oUF -->

There are six actions, all scoped to the account through the owning agent: <!-- id:32igKmQg -->
  - `ListAgentTriggers {agentId}` <!-- id:LTDaOlak -->
  - `GetAgentTrigger {triggerId}`: returns the trigger, its sessions, up to 25 most recent firings, and `webhookSecret` for editors. <!-- id:5sWdcAKU -->
  - `CreateAgentTrigger {agentId, trigger, clientRequestId?}` <!-- id:UNaF32tJ -->
  - `UpdateAgentTrigger {triggerId, patch, expectedUpdatedAt?}`: the optional timestamp refuses a stale edit. <!-- id:f18H8tDf -->
  - `DeleteAgentTrigger {triggerId}` <!-- id:LgMQdOP3 -->
  - `CombineAgentTriggers {triggerId, otherTriggerId, expectedUpdatedAt, otherExpectedUpdatedAt, useOtherAction?}`: merges the other trigger's conditions, firings, and claims into this one and retires the other with `mergedInto`. <!-- id:HwXBs7E9 -->

Deleting a trigger detaches its runs and removes its firings. Sessions it created are kept. Details are in the [signed API](../build/signed-api.md). <!-- id:JMPdcC4g -->

Two more actions serve trigger documents. `ListHostTriggers {hostId}` returns the triggers of an app or an agent as the server holds them, with their recent firings and the ones it could not use. `RunTriggerNow {triggerId}` fires a schedule trigger once, as its schedule would, for a writer of its host.

# See also <!-- id:aqgk0ha- -->

- [Trigger](../trigger.md), the concept, and how a trigger document relates to the server.
- [Firing](./firing.md) for deduplication, statuses and the loop guard. <!-- id:5xLIJVIG -->
- [Webhooks](./webhooks.md) for delivering events from outside.
- [park and wait](./park.md) and [wake source](./wake-source.md), for the runs a `wake` continuation reaches. <!-- id:KzpZ9_1r -->
- [Persistence](../operate/persistence.md) for the `agent_triggers`, `trigger_firings`, and `activity_watermarks` tables. <!-- id:iGyU4fg4 -->
- [Operations](../operate/run-queue.md) for the monitor configuration and the run queue. <!-- id:wUmHU66d -->
- [Agents glossary](./glossary.md) for every agent term. <!-- id:Bm3zr_cA -->
