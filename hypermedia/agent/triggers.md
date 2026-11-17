---
name: Triggers
summary: "This is the reference for triggers: the nine sources that fire one, what a firing does, how a trigger document stores its source, how the monitors match events, and the ways to edit triggers."
---
A [trigger](../trigger.md) lets an [agent](../agent.md) or an [app](../app.md) act when nobody is talking to it. It joins a **source**, the thing that happens, to a **continuation**, the thing to do about it. For example, the source can be a [comment](../protocol/comments.md) that mentions the agent, and the continuation can be a new [session](./session.md) with the agent. <!-- id:89o2eplg -->

This page is the reference: every source, every continuation, how events are matched, and the ways to edit triggers. Read [Trigger](../trigger.md) first for the idea.

A trigger has two forms, and their rules differ. A **trigger document** is a [document](../protocol/documents.md) under an app or an agent. A **trigger stored on the server** is a row that only the agent's server holds, on the [app environment](../software/app-environment.md). Each section says which form it is about. Triggers let an agent act with nobody watching, so the [security](./security.md) page covers them too.

# The data model <!-- id:G5lPmDWS -->

On the server, every trigger of either form is a row. The row has a name, an enabled flag, a source, an optional prompt, and an optional continuation. The protocol types are in `apps/protocol/src/index.ts`: <!-- id:x0qddyHJ -->

```ts <!-- id:viN8eyx_ -->
type AgentTriggerInput = {
  name: string
  enabled?: boolean
  source: AgentTriggerSource
  prompt?: string | AgentPromptBlock[]   // required for newThread; a recovery prompt for tool/script
  continuation?: TriggerContinuation     // omitted means newThread
}
```

Prompts accept the same rich Seed [block](../protocol/blocks.md) format as agent [system prompts](./prompt.md). A plain string is parsed as markdown. Blocks are rendered to markdown before the thread starts. <!-- id:4uU-k5AH -->

A trigger document has the same source. The server turns its `tool`, `input` and body into the continuation and the prompt:

- If the document names a tool, the continuation is `tool`.
- Otherwise the continuation is the default `newThread`, and the body is the prompt.

The row of a trigger document also records the document's id, the version it was read from and its author.

## Sources <!-- id:HPNBLtru -->

There are nine source types: the five activity sources, `activity` (a list of them), `schedule`, `webhook` and `run-completed`. The first five rows of the table are the activity sources. Both forms of trigger use the same sources.

<!-- id:dzNzPOSx -->
| source <!-- col:rpXTaztr --> | fires when <!-- col:y58r3u6I --> | fields <!-- col:KRwHxbA4 --> <!-- id:JZv2m3xq --> |
| --- | --- | --- |
| `document-comment` | a new comment appears on a resource (a document, by its [hm:// URL](../protocol/urls.md)) | `resource`, optional `author` <!-- id:6QPvQAAG --> |
| `user-mention` | a comment or document mentions one of the listed accounts, including a document attribute such as `owner` set to one of them | `mentionedAccounts[]`, optional `resourcePrefix` <!-- id:tQpu4TSH --> |
| `comment-reply` | a comment replies directly to a comment by one of the listed accounts; an account's reply to itself never matches | `repliedToAccounts[]`, optional `resourcePrefix` <!-- id:jlCK6tbO --> |
| `document-author-comment` | a comment appears on a document one of the listed accounts authored; the author's own comments never match | `documentAuthors[]`, optional `resourcePrefix` <!-- id:mf2zxBhI --> |
| `site-update` | new activity appears under a resource prefix; activity the trigger's own agent authored (signed by one of its [signing identities](./identity.md)) never matches unless `includeOwnActivity` is true, so an agent writing or commenting under a prefix it watches does not start itself again | `resourcePrefix`, optional `eventTypes[]` (`doc-update`, `comment`, `citation`, `capability`, `contact`), optional `includeOwnActivity` <!-- id:fyoQw9B_ --> |
| `activity` | any one of its conditions matches; the event fires the trigger once however many conditions match | `conditions[]`, each `{id, source}` where `source` is one of the five activity sources above <!-- id:awQJs1x6 --> |
| `schedule` | a clock says so | `schedule`: `{kind: 'interval', every, unit}`, `{kind: 'weekly', daysOfWeek, timeOfDay, timesOfDay?, timezone}` (`timesOfDay` lists several times a day), or `{kind: 'once', runAt, timezone?}` <!-- id:oXlkndG5 --> |
| `webhook` | something POSTs JSON to the trigger's delivery URL | none; the secret is created with the trigger. See [webhooks](./webhooks.md) <!-- id:-P02QGwG --> |
| `run-completed` | a [run](./runs.md) of this account reaches a final status | optional `agentId`, [`status`](./tools.md) (`succeeded`, `failed`, `canceled`), `titleMatch` <!-- id:4JzuZ8WZ --> |

The server rejects an empty account list.

Creating an agent with a signing identity also creates one enabled `activity` trigger, named "Mentions, replies, and comments for \<agent>". It has three conditions on the account `self`: a `user-mention`, a `comment-reply`, and a `document-author-comment`. In those three sources, `self` means whichever accounts the agent signs as when an event arrives. So the trigger follows a new primary account. When the server publishes a stored trigger as a document, it turns the agent's own account ids into `self`. That is why an agent answers when you mention its [account](../protocol/identity.md) in a comment, reply to it, or comment on a document it published. <!-- id:0m8OvinP -->

Each condition of an `activity` trigger has a stable `id`. A firing records which conditions matched (`matchedConditions`), and a session the firing started shows them.

Two triggers stored on the server can be merged into one with `CombineAgentTriggers`. The one that stays takes both condition lists, both histories and both sets of deduplication claims. The other is retired with `mergedInto` set. A retired trigger cannot be edited or turned on again. `UpdateAgentTrigger` accepts an `expectedUpdatedAt`, so two editors cannot overwrite each other without knowing. <!-- id:2RZmc9Te -->

Changing to or from a webhook source depends on the form:

- A trigger stored on the server cannot change between a webhook source and any other source. Make a new trigger instead.
- A trigger document can. The server makes a new secret when the source becomes a webhook, and forgets the secret when the source changes away.

## Continuations <!-- id:SAHaWbYq -->

<!-- id:_HtUAkvy -->
| kind <!-- col:qqgDTBwN --> | what the firing does <!-- col:Dq0GeKn8 --> | model involved <!-- col:lmflRnlh --> <!-- id:FPjWAF39 --> |
| --- | --- | --- |
| `newThread` (default) | starts a session whose first message is the prompt plus a `<trigger_context>` block; `systemPrompt` adds instructions, `includeAgentSystemPrompt` (default true) can omit the agent's own prompt, `tools` narrows the grants | always <!-- id:9ArI3pSq --> |
| `wake` | delivers `signal` (with optional `payload`) to a run [parked](./park.md) on `ctx.waitForEvent`, the same delivery `SignalRun` makes; without `runId` the account's parked runs are searched for one the signal satisfies | never, the run decides <!-- id:c1T1oEj7 --> |
| `tool` | calls one tool headlessly as a journaled workflow run: `read`, `write`, any granted callable (a builtin or an MCP tool), or a [tool](../tool.md) by its hm:// URL. A [callable](./callables.md) is anything the agent's [`call` verb](./call.md) reaches | never, unless `onFailure: 'thread'` and it fails <!-- id:Uh5xlgMG --> |
| `script` | runs a workflow [script](./script.md) module (`export default async function (input, ctx)`) headlessly, with `ctx.input = {event, input, trigger: {id, name, firingId}}` | only if the script calls `ctx.delegate`, or on failure with `onFailure: 'thread'` <!-- id:3vfSy0-V --> |

For `tool`, `input` defaults to the trigger event itself. When you give an `input`, it is a JSON template. String values `"$event"` and `"$event.<path>"` are replaced from the event. For a webhook, the posted JSON is `"$event.payload"`. The tool name is checked when the trigger is written, because a headless firing has nobody to read a "no such tool" error. A `script` is checked by the workflow linter at write time: no `Date`, `Math.random`, timers, `fetch`, or imports, and exactly one default export. It is capped at the workflow source limit. The [journal](./journal.md) and [tool document](./tool-document.md) pages explain the run and the tool it calls. <!-- id:_ju96vTR -->

`onFailure` exists only on a trigger stored on the server. It is `none` or `thread`:

- With `none` (the default), the server records the error on the firing and the trigger.
- With `thread`, the ordinary trigger thread starts. Its context holds an `automationFailure` block and an instruction to `read run:<id>` and recover.

The prompt is optional for the `tool` and `script` kinds. When it is left out, the server stores a default recovery prompt, because the prompt is only used after a failure. <!-- id:Sh0R1Ar4 -->

A trigger document expresses two of these continuations:

- a `tool` continuation that calls a tool of its own host by hm:// URL;
- a plain `newThread`, with no `systemPrompt`, no narrowed `tools`, and the agent's own prompt included.

A trigger document has no `onFailure`. A failed tool call is recorded on the firing. Every other continuation exists only on a trigger stored on the server. See [the document and the server](../trigger.md).

## The document form

This section is about trigger documents only. A trigger document stores its source and input template as nested [metadata](../metadata.md) attributes.

Document attributes merge key by key, and a list is one value that is replaced whole (see [how concurrent edits resolve](../protocol/documents.md)). So the source keeps each set as a map, with one key per entry:

- `daysOfWeek: {mon: true, fri: true}`
- `timesOfDay: {"08:00": true}`
- `mentionedAccounts`, `repliedToAccounts` and `documentAuthors` as `{<account or self>: true}`
- `eventTypes: {comment: true}`
- `conditions` keyed by each condition's id

Turning one day off is then a change to one key. Two people who edit different entries both keep their edits.

The trigger engine works with lists. `triggerSourceToMetadata` and `triggerSourceFromMetadata` in `@seed-hypermedia/client/apps` convert between the two shapes. Writing a whole `source` or `input` clears it first, then sets each entry, so nothing from the old shape remains.

# Firing <!-- id:W_1FNPPe -->

Each time a trigger goes off is a [firing](./firing.md). A firing is a row in `trigger_firings` with a unique key, so one event fires a trigger once. Firings of one trigger that start a session run one at a time. Chains of run-completed triggers stop after 8 hops. The firing page has the keys, the statuses and the loop guard.

# The monitors <!-- id:HV4oYfVQ -->

The **activity monitor** polls the Hypermedia server's activity feed, which is the `ListEvents` request of the [Seed API](../build/web-api.md). The settings are: <!-- id:kVkFZO2M -->
  - `SEED_APPS_ACTIVITY_POLL_INTERVAL_MS`: how often it polls (default 5 seconds). <!-- id:9klo2uSO -->
  - `SEED_APPS_ACTIVITY_PAGE_SIZE`: events per page (50). <!-- id:Xa9UInqU -->
  - `SEED_APPS_ACTIVITY_MAX_PAGES`: pages per poll (5). <!-- id:bzLCYoSZ -->

How the activity monitor works: <!-- id:nkzChSE8 -->

- The monitor only polls for accounts that have at least one enabled trigger that is not a schedule. Webhook and run-completed triggers keep polling alive too.
- Each event goes to two consumers through one shared matcher: trigger matching, and any run parked on `ctx.waitForEvent({eventType, resource, author})` for that account.
- The monitor asks for the feed in **observed** order. So a [blob](../protocol/blobs.md) that reached the server late appears at the top when it arrives.
- An event is new when its key is not in the account's watermark. The watermark is a ring of the most recently seen keys.
- The event's create time does not matter. A comment that reaches the server hours after it was written still fires when the monitor first sees it.
- There is one filter by time, on the first poll for an account. That poll only admits events created after the account's earliest enabled trigger.
- The watermark moves forward after each firing is saved. The watermark is saved too (`activity_watermarks`). So after a restart the monitor continues from the last handled event and does not replay.
- Polling depends on triggers. A wait for activity on an account with no enabled activity trigger only ends by timeout. A wait for a signal does not depend on polling.

The **schedule monitor** checks enabled `schedule` triggers on the same interval, records their firings, and disables a `once` trigger at fire time, before its run starts. <!-- id:4faqwRaM -->

The HTTP server delivers **webhooks** synchronously, with no polling. [Webhooks](./webhooks.md) has the delivery URL, the secret and the responses.

**Run-completed** fires inline when a run is finalized. There is no polling. <!-- id:KKT9w-mu -->

A trigger thread is a normal session whose first run has `origin: 'trigger'`. Origin is a property of the run, not the session. The session carries `startedByTrigger`, an `AgentSessionTriggerContext` snapshot taken when the trigger fired. It holds the trigger, the firing, the activity summary, the full event, the conditions that matched, the prompt as it was then, and the firing's status and error. Later edits to the trigger do not rewrite it. The UI shows it as a context card, and the model sees it as `<trigger_context>`.

Trigger runs go on the background queue. The server tries a background agent run up to three times. So a firing that fails because a [model provider](./model-providers.md) had a short problem is retried before it is recorded as failed. [The run queue](../operate/run-queue.md) describes it. <!-- id:4m4FD6FE -->

# Working with triggers <!-- id:mTG59Yfj -->

There are three ways to edit triggers: the [Seed app](../software/desktop.md), the agent itself, and the [signed API](../build/signed-api.md). In each, you change a trigger document by publishing a new version of the document. The actions that edit triggers stored on the server refuse a trigger document and name the document.

## In the Seed app <!-- id:jvEv2j0H -->

A [mounted agent](./mounting.md)'s **Triggers** tab lists its trigger documents first, the same way an app does. A trigger document opens inside the agent, and its edits stay in a draft until you publish them from the top bar. [Building an app](../build/building-an-app.md) describes that view.

Triggers stored on the server follow under **On the server**, when there are any. Each of those opens in a detail view with: <!-- id:zchsSkup -->
  - name and enabled toggle <!-- id:hgkjPBKI -->
  - the source and its form: a **When any of these happen** list of conditions with **Add condition** and a type menu for each condition (**Comment posted**, **User mention**, **Reply to account**, **Comment on account's document**, **Document updated**, **Reference added**, **Access granted**, **Contact updated**, then **Schedule** and **Webhook**), document autocomplete for comment conditions, account and [site](../protocol/sites.md) autocomplete, and interval, weekly, and one-time schedule forms; run-completed is shown only on triggers that already use it <!-- id:JJha9v1A -->
  - the prompt in the block editor <!-- id:anUmCwS4 -->
  - the continuation choice: **Start a thread (model handles it)**, **Call a tool (no model)**, **Run a script (no model)**, or **Wake a parked run**, with a tool picker fed by the agent's tools, a JSON input template, a script editor, a signal field for `wake`, and the on-failure toggle <!-- id:CdsHU--l -->
  - **Combine with another trigger**, and a **Combined** badge on a retired trigger <!-- id:VdlOvvV9 -->
  - last checked, last fired, the next fire for a schedule, and the last error <!-- id:VMDh9Iw3 -->
  - **Firings** with status, event summary, error, a link to the thread, and an inline run card for headless runs <!-- id:XHZ8P3WK -->

In this view every edit saves by itself. The list refreshes live from `trigger-updated` account events, so triggers an agent creates for itself appear at once. [Agents in the Seed app](./in-the-app.md) covers the other screens. <!-- id:Bwq9P3yn -->

Apps have a **Triggers** tab too. It lists trigger documents only, because an app has no triggers stored on the server. [Building an app](../build/building-an-app.md) walks through making one.

## The agent itself <!-- id:bBRPFDh1 -->

An agent manages its own triggers with the [read](./read.md) and [write](./write.md) verbs: <!-- id:KA4JCbvJ -->
  - `read ~/triggers/` lists them, of both forms, with the write contract inline. <!-- id:BdwUYPMG -->
  - `read ~/triggers/<name>` returns one trigger with its five most recent firings. <!-- id:fB7qLr6W -->
  - `write ~/triggers/<name>` creates, edits, enables, disables, or deletes a trigger stored on the server, by name or id. It keeps `enabled` as written. <!-- id:PqNfXf2G -->
  - `write hm://<account>/<agent or app path>/<name>` with `options.trigger` publishes a trigger document. An agent that already has trigger documents must use this for every new trigger a document can express. `~/triggers/<name>` then takes only the rest.

The [Space index](./space-index.md) always tells the agent about this, so an agent can complete "do this every morning" in one turn. Nobody has to approve: agents manage their own triggers directly. The [security](./security.md) page records what that means for the threat model. <!-- id:j1HGdgrc -->

## Signed API <!-- id:6JaK_oUF -->

There are six actions for triggers stored on the server. Each is limited to the signing account, through the agent that owns the trigger: <!-- id:32igKmQg -->
  - `ListAgentTriggers {agentId}` <!-- id:LTDaOlak -->
  - `GetAgentTrigger {triggerId}`: returns the trigger, its sessions, up to 25 most recent firings, and `webhookSecret` for editors. <!-- id:5sWdcAKU -->
  - `CreateAgentTrigger {agentId, trigger, clientRequestId?}` <!-- id:UNaF32tJ -->
  - `UpdateAgentTrigger {triggerId, patch, expectedUpdatedAt?}`: the optional timestamp refuses a stale edit. <!-- id:f18H8tDf -->
  - `DeleteAgentTrigger {triggerId}` <!-- id:LgMQdOP3 -->
  - `CombineAgentTriggers {triggerId, otherTriggerId, expectedUpdatedAt, otherExpectedUpdatedAt, useOtherAction?}`: merges the other trigger's conditions, firings, and claims into this one and retires the other with `mergedInto`. <!-- id:HwXBs7E9 -->

Deleting a trigger detaches its runs and removes its firings. Sessions it created are kept. The shapes are in [the signed API for triggers](../build/signed-api-triggers.md). <!-- id:JMPdcC4g -->

Two more actions work with trigger documents:

- `ListHostTriggers {hostId}` returns the triggers of an app or an agent as the server holds them, with their recent firings. It also returns the ones the server could not use.
- `RunTriggerNow {triggerId}` fires a schedule trigger once, as its schedule would. It needs write access to the trigger's document. It also works on a schedule trigger stored on the server, for a writer of the agent.

# See also <!-- id:aqgk0ha- -->

- [Trigger](../trigger.md), the concept, and how a trigger document relates to the server.
- [Firing](./firing.md) for deduplication, statuses and the loop guard. <!-- id:5xLIJVIG -->
- [Webhooks](./webhooks.md) for delivering events from outside.
- [park and wait](./park.md) and [wake source](./wake-source.md), for the runs a `wake` continuation reaches. <!-- id:KzpZ9_1r -->
- [Persistence](../operate/persistence.md) for the `agent_triggers`, `trigger_firings`, and `activity_watermarks` tables. <!-- id:iGyU4fg4 -->
- [Configuration](../operate/configuration.md) for the monitor settings, and [the run queue](../operate/run-queue.md). <!-- id:wUmHU66d -->
- [Agents glossary](./glossary.md) for every agent term. <!-- id:Bm3zr_cA -->
