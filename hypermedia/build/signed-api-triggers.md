---
name: "Signed API: triggers"
summary: These signed API actions list, create, change, combine and fire triggers, and this page also gives the trigger input types and the webhook delivery route.
---
These actions of the [signed API](./signed-api.md) manage [triggers](../trigger.md) stored on the server and list the triggers that [documents](../protocol/documents.md) define. The page also has the route that receives webhooks. For example, a client sends `CreateAgentTrigger` to make an [agent](../agent.md) act every morning.

A trigger has two forms: a trigger document, and a trigger stored only on an agent's server. The six `…AgentTrigger…` actions work on triggers stored on the server and refuse a trigger document. You change a trigger document by publishing a new version of it. `ListHostTriggers` and `RunTriggerNow` work with trigger documents.

[Trigger](../trigger.md) says what a trigger is, and the [trigger reference](../agent/triggers.md) says how it fires. The [signed API](./signed-api.md) page has the envelope, the endpoint, errors, [access levels](./signed-api.md#access-levels) and idempotency.

# Types

```ts <!-- id:SqGO3ixi -->
type AgentActivitySource =
  | {type: 'document-comment'; resource: string; author?: string}
  | {type: 'user-mention'; mentionedAccounts: string[]; resourcePrefix?: string}
  | {type: 'comment-reply'; repliedToAccounts: string[]; resourcePrefix?: string}
  | {type: 'document-author-comment'; documentAuthors: string[]; resourcePrefix?: string}
  | {type: 'site-update'; resourcePrefix: string; eventTypes?: string[]; includeOwnActivity?: boolean}

type AgentTriggerSource =
  | AgentActivitySource
  | {type: 'activity'; conditions: {id: string; source: AgentActivitySource}[]}
  | {type: 'webhook'}
  | {type: 'schedule'; schedule: AgentScheduleTrigger}
  | {
      type: 'run-completed'
      agentId?: string
      status?: 'succeeded' | 'failed' | 'canceled'
      titleMatch?: string
    }

type AgentScheduleTrigger =
  | {kind: 'interval'; every: number; unit: 'minutes' | 'hours'}
  | {kind: 'weekly'; daysOfWeek: number[]; timeOfDay: string; timesOfDay?: string[]; timezone: string}
  | {kind: 'once'; runAt: number; timezone?: string}

type TriggerContinuation =
  | {kind: 'newThread'; systemPrompt?: string; includeAgentSystemPrompt?: boolean; tools?: string[]}
  | {kind: 'wake'; signal: string; runId?: string; payload?: unknown}
  | {kind: 'tool'; tool: string; input?: unknown; onFailure?: 'none' | 'thread'}
  | {kind: 'script'; script: string; input?: unknown; onFailure?: 'none' | 'thread'}

type AgentTriggerInput = {
  name: string
  enabled?: boolean
  source: AgentTriggerSource
  prompt?: string | AgentPromptBlock[] // required for newThread; a recovery prompt for tool/script
  continuation?: TriggerContinuation // omitted means newThread
}
```

The rules the server applies to input:

- `prompt` takes the same [block](../protocol/blocks.md) format as an agent's system prompt. A string is parsed as markdown. <!-- id:_BARyrTk -->
- A `user-mention` source watches a list of [accounts](../protocol/identity.md), and an empty list is rejected. A single `mentionedAccount` is accepted for older clients and stored as `mentionedAccounts`. A `comment-reply` source matches a [comment](../protocol/comments.md) that replies directly to a comment by one of `repliedToAccounts`, never an account's reply to itself. A `document-author-comment` source matches a comment on a document authored by one of `documentAuthors`, never an author's own comment. <!-- id:DEsKZQQU -->
- Document fields (`resource`, `resourcePrefix`) must name an account or document (`hm://<account uid>[/path]`); a bare `hm://` or a wildcard is rejected rather than treated as "everything". `site-update` `eventTypes` must be one of `doc-update`, `comment`, `citation`, `capability`, `contact`. The aliases `document-update`, `change` and `ref` are accepted for older clients. <!-- id:LOAwm0zb -->
- An `activity` source matches any of its 1–32 conditions. Condition IDs must be unique and remain stable when edited; the server assigns an ID if omitted on input. Nested groups and schedule/webhook/run-completed conditions are rejected. One comment matching both a document filter and a mention filter admits only one firing, including sibling feed events arriving in separate polls. Distinct triggers remain independent. <!-- id:6E0x_XJ4 -->
- An `activity` source needs protocol 3. An older client receives an update-required error. <!-- id:tBM-H-zG -->
- `continuation` says what a firing does. Omitted, it is `newThread`: a fresh session from the trigger's prompt. `wake` delivers a signal to a [parked](../agent/park.md) run through the same path as `SignalRun`. Without `runId`, the server searches the account's parked runs for one the signal satisfies. <!-- id:htPFS_iB -->
- `run-completed` lets one trigger follow another: it fires when a run of this account reaches a final status. The server stops loops. It skips a firing when the chain that led to it already contains the same trigger within 8 hops. <!-- id:yhR4cigG -->

# Actions

- `ListAgentTriggers {agentId}` returns `{_: 'ListAgentTriggersResponse'; triggers: AgentTriggerInfo[]}`. <!-- id:bXFKEmdY -->
- `GetAgentTrigger {triggerId}` returns `{_: 'GetAgentTriggerResponse'; trigger: AgentTriggerInfo; sessions: SessionInfo[]; firings: TriggerFiringInfo[]; webhookSecret?: string}` (at most 25 firings; the secret only for writers). <!-- id:zek5I_eN -->
- `CreateAgentTrigger {agentId, trigger, clientRequestId?}` returns `{_: 'CreateAgentTriggerResponse'; trigger; webhookSecret?}` (the plaintext secret of a new webhook trigger). <!-- id:0u89fDzQ -->
- `UpdateAgentTrigger {triggerId, patch}` returns `{_: 'UpdateAgentTriggerResponse'; trigger}`. <!-- id:GD1HRkZ9 -->
- `DeleteAgentTrigger {triggerId}` returns `{_: 'DeleteAgentTriggerResponse'; triggerId}`. <!-- id:6K2fNfnq -->
- `CombineAgentTriggers {triggerId, otherTriggerId, expectedUpdatedAt, otherExpectedUpdatedAt, useOtherAction?}` combines two activity triggers of the same agent and returns `UpdateAgentTriggerResponse`. The first survives and keeps its name and enabled state. Its action stays unless `useOtherAction` is true. The other becomes disabled with `mergedInto` and cannot be edited or enabled again. Both histories stay available, and events already handled stay deduplicated. <!-- id:nkfEQP4t -->
- `ListHostTriggers {hostId}` returns `{_: 'ListHostTriggersResponse'; hostId; active: boolean; triggers: {trigger: AgentTriggerInfo; webhookSecret?: string; firings: TriggerFiringInfo[]}[]; errors: {documentId: string; error: string}[]}`. `hostId` is the versionless `hm://` URL of an app or agent. The server reads the host's [trigger documents](../trigger.md) first, then lists what they define here. `active` is false when the server does not run the host. A writer of the host's [space](../protocol/spaces.md) also gets webhook secrets.
- `RunTriggerNow {triggerId}` returns `{_: 'RunTriggerNowResponse'; firing: {id: string; sessionId?: string; runId?: string}}`. It fires a schedule trigger once, at once, the way its schedule would. It works on a trigger document and on a trigger stored on the server. It refuses a trigger that is not a schedule, and a trigger that wakes a run. For an app's trigger, `runId` is a label (`app-<firingId>`), not a run you can read.

`UpdateAgentTrigger` accepts an optional `expectedUpdatedAt` and rejects an edit based on an old copy with 409. A trigger stored on the server cannot change between a webhook source and any other source, so `UpdateAgentTrigger` answers 400 to that. `CreateAgentTrigger` supports the same `clientRequestId` idempotency pattern as other create actions. <!-- id:GOO4iIKu -->

Who may send each action:

- `ListAgentTriggers` and `GetAgentTrigger` need reader access to the agent.
- `CreateAgentTrigger`, `UpdateAgentTrigger`, `CombineAgentTriggers` and `DeleteAgentTrigger` need writer access to the agent.
- `ListHostTriggers` needs only a signed account.
- `RunTriggerNow` needs write access to the trigger's document, or writer access to the agent for a trigger stored on the server.

# Webhook delivery

Webhook deliveries are plain HTTP requests, not signed API messages. A sender uses `POST /hm/api/agents/webhooks/<triggerId>/<secret>`, or `POST /hm/api/agents/webhooks/<triggerId>` with `Authorization: Bearer <secret>`. The body is JSON and the answer is `202 {accepted, duplicate}`. The same routes answer under `/hm/api/apps`. The server also accepts `/agents/api/webhooks/…`, for older URLs. See [webhooks](../agent/webhooks.md). <!-- id:fGfNUBu9 -->

# See also

- [Signed API](./signed-api.md)
- [Trigger](../trigger.md)
- [Trigger reference](../agent/triggers.md) <!-- id:iAepIbNB -->
- [Webhooks](../agent/webhooks.md)
- [Sessions and runs](./signed-api-sessions.md)
