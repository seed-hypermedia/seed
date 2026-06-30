# Agent triggers plan

Status: Phase 1 CRUD and UI shell has started. Backend CRUD/persistence and the desktop Triggers tab/detail shell are in
place. Phase 2 matching/idempotency utilities and background ActivityFeed polling have started. Schedule triggers are
now implemented with interval, weekly, and one-time modes plus a background schedule monitor. Recent fix: first
ActivityFeed poll now processes events observed after trigger creation instead of dropping them into the baseline.

This plan describes the first product and engineering pass for **agent triggers**: saved rules that watch Seed activity
and automatically create a new agent session with a configured prompt when matching activity occurs.

## Product goal

Agent triggers let an account owner attach proactive workflows to an existing agent. A trigger belongs to one agent and
defines:

- **when** the trigger should fire, expressed as a trigger source/filter such as a comment in a document, a mention of a
  user, or new activity within a site;
- **what prompt** should start the session when it fires;
- **how to manage sessions** created by prior firings.

The first release should feel like part of the existing agent detail page, not like a separate automation product.

## User experience

### Agent page navigation

Add a new **Triggers** tab to the agent detail page, beside the existing Sessions, Prompt, and Settings tabs.

The Triggers tab has two states:

1. **Trigger list** — shows all triggers saved for the agent, plus a **New trigger** button.
2. **Trigger detail** — shown after clicking a trigger. The user remains within the agent page header and Triggers tab,
   with breadcrumbs such as:

```text
Agents / Research Agent / Triggers / Comments on launch spec
```

The trigger detail page should be addressable by route so refresh/deep-link preserves the selected trigger.

### New trigger dialog

The **New trigger** button opens a dialog that creates each trigger. The dialog should collect the minimum viable
fields:

- name;
- enabled/disabled state, default enabled;
- trigger type;
- type-specific filters;
- prompt to use when a session is created.

Initial trigger types:

1. **Comment in a document**
   - document/resource ID or URL;
   - optional author filter;
   - fires when a new comment appears for that document.
2. **User mention**
   - mentioned account/user ID;
   - optional resource/site filter;
   - fires when activity reports a matching mention.
3. **Site update**
   - site/account/domain/resource-prefix selector;
   - optional event-type filter, initially `doc-update` and `comment`;
   - fires when new matching activity appears within that site scope.
4. **Schedule**
   - every \* hours/minutes OR
   - daily, allow the user to choose the time of day, which days of the week
   - ONCE: date picker for exactly when to trigger

The prompt field should explain that runtime context will be added by the server. Example placeholder:

```text
A new comment was added to the launch spec. Read the document and comment, summarize what changed, and create a useful reply comment.
```

### Trigger detail page

Clicking a trigger opens an editable detail page with:

- name;
- enabled/disabled toggle;
- trigger type and filters;
- prompt;
- operational metadata: created time, updated time, last checked time, last fired time, last error;
- save/delete controls;
- a bottom section listing sessions created by this trigger.

The sessions list should show the same core session fields used in the Sessions tab, plus firing metadata:

- session title;
- status;
- created time;
- matching activity summary;
- link to the session page.

## Data model

Add agent-scoped trigger storage. Suggested protocol shape:

```ts
type AgentTriggerInfo = {
  id: string
  agentId: string
  name: string
  enabled: boolean
  source: AgentTriggerSource
  prompt: string
  createdAt: string
  updatedAt: string
  lastCheckedAt?: string
  lastFiredAt?: string
  lastError?: string
}

type AgentTriggerSource =
  | {
      type: 'document-comment'
      resource: string
      author?: string
    }
  | {
      type: 'user-mention'
      mentionedAccount: string
      resourcePrefix?: string
    }
  | {
      type: 'site-update'
      resourcePrefix: string
      eventTypes?: string[]
    }
  | {
      type: 'schedule'
      schedule:
        | {kind: 'interval'; every: number; unit: 'minutes' | 'hours'}
        | {kind: 'weekly'; daysOfWeek: number[]; timeOfDay: string; timezone: string}
        | {kind: 'once'; runAt: number; timezone?: string}
    }
```

Persist triggers in a new `agent_triggers` table:

- `id` primary key;
- `account_id`;
- `agent_id`;
- `enabled`;
- `name`;
- `source_cbor`;
- `prompt`;
- `created_at`;
- `updated_at`;
- `last_checked_at`;
- `last_fired_at`;
- `last_error`.

Track created sessions with explicit trigger firing records instead of only storing `trigger_id` on sessions. Suggested
table:

- `trigger_firings`
  - `id` primary key;
  - `account_id`;
  - `agent_id`;
  - `trigger_id`;
  - `activity_key` unique per trigger;
  - `session_id` nullable until session creation succeeds;
  - `activity_cbor` summary of the matched feed event;
  - `status` (`created`, `skipped`, `error`);
  - `error`;
  - `created_at`.

The `activity_key` must be stable and derived from the feed event identity, for example event type plus blob
ID/CID/resource/observe time as available. Add a uniqueness constraint on `(account_id, trigger_id, activity_key)` so
feed retries are idempotent.

> **Comment mentions emit two sibling feed events.** A comment that @mentions an account produces both a `comment` event
> (`feedEventId: blob-<cid>`) and a comment-sourced `citation` event (`feedEventId: mention-<cid>--<target>`) that share
> the same comment-version CID. They are indexed seconds apart and can land in different polls, and the staleness
> watermark can drop whichever arrives second. Both are therefore allowed to match (`matchesSingleMention` no longer
> suppresses `citationType: 'c'`), and `activityTriggers.activityFiringKey` collapses the citation onto its comment
> sibling's `blob-<cid>` identity before the `trigger_firings` insert — so the mention fires **exactly once** regardless
> of which sibling is processed first, and survives the other being dropped. Both resolved siblings carry the full
> comment body (`loadCitationEvent` fetches it for `'c'` citations), so context is preserved whichever one fires.
> Regression coverage: `src/activity-trigger-race.test.ts` (real monitor → HTTP → service) and
> `scripts/smoke-trigger.ts` (`bun run test:trigger`, real daemon).

Track feed progress separately from individual triggers:

- `activity_watermarks`
  - `account_id`;
  - `server_url` or HM source ID;
  - `cursor` or compound watermark payload;
  - `last_poll_at`;
  - `last_success_at`;
  - `last_error`.

Because the current activity API is newest-first and page-token based, the first implementation should store a
conservative high-water mark based on observed event identity and time rather than assuming a single monotonic offset
exists.

## Signed API changes

Add actions to `agents/protocol/src/index.ts` and handle them in `agents/src/api-service.ts`:

- `ListAgentTriggers {agentId}` → `ListAgentTriggersResponse {triggers}`;
- `GetAgentTrigger {triggerId}` → `GetAgentTriggerResponse {trigger, sessions}`;
- `CreateAgentTrigger {agentId, trigger, clientRequestId?}` → `CreateAgentTriggerResponse {trigger}`;
- `UpdateAgentTrigger {triggerId, patch}` → `UpdateAgentTriggerResponse {trigger}`;
- `DeleteAgentTrigger {triggerId}` → `DeleteAgentTriggerResponse {triggerId}`.

Ownership checks must always verify `(account_id, agent_id, trigger_id)` relationships. Trigger actions should follow
the existing signed CBOR API and idempotency patterns.

Update WebSocket broadcasts so changes to triggers invalidate:

- the account agent list if summary counts are shown;
- `agents/<agentId>` detail;
- a future `agent-triggers/<agentId>` subscription key, if added.

## Server runtime design

The agent server is responsible for reliable trigger execution. Desktop should only manage trigger CRUD.

### Activity monitor

Add a background activity monitor inside the agents service that:

1. discovers accounts with at least one enabled trigger;
2. polls the HM server ActivityFeed for those accounts/scopes;
3. pages backward from newest activity until it reaches known events/watermarks;
4. evaluates enabled triggers against each new event in chronological order;
5. inserts a `trigger_firings` row before creating a session;
6. creates a session and sends the configured prompt when a trigger matches;
7. updates firing status, trigger metadata, and the activity watermark.

Avoid firing triggers during startup before the server has established a baseline. On first run for an account/server,
store the current feed head as the watermark and only fire on future activity unless an explicit backfill mode is added
later.

### Matching rules

Keep matching simple and transparent in the first release:

- `document-comment`: match `NewBlobEvent.blob_type == 'Comment'` and exact resource ID, or resource-prefix match if
  comments use target-specific resource IDs;
- `user-mention`: match `Event.new_mention` where the mentioned account equals the trigger target;
- `site-update`: match resource prefix and selected feed event types, initially `doc-update` and `comment`. Legacy
  low-level blob type filters such as `Ref`, `Change`, and `Comment` are still accepted as aliases where possible.

Normalize user-entered URLs/resource IDs at the API boundary when triggers are created or updated. Store canonical
resource IDs/prefixes so internal matching can compare exact strings.

### Session creation

A trigger firing creates a normal session for the owning agent. The initial user message should include:

- the trigger prompt;
- a compact machine-readable context block containing trigger ID, firing ID, activity type, resource, author/account,
  timestamps, and relevant CIDs/blob IDs;
- enough links/IDs for the agent to call `read` for full context.

Suggested session title format:

```text
<Trigger name> — <short activity summary>
```

Add session metadata or a firing table join so the UI can list sessions created by a trigger without parsing messages.

### Reliability and concurrency

Requirements:

- evaluate each activity event at most once per trigger using the `(trigger_id, activity_key)` uniqueness constraint;
- do not advance the account/server watermark past events that failed before they were recorded;
- process events in deterministic chronological order after fetching newest-first pages;
- use a per-account monitor lock so two loops do not race in the same process;
- tolerate process restarts by recovering from persisted watermarks and firing records;
- retry transient HM server/model-provider failures with bounded backoff;
- record permanent trigger errors on the trigger and firing records.

Do not use sleeps to fix races. Poll intervals and backoff are acceptable as scheduling, but correctness must come from
durable watermarks and idempotency constraints.

## Desktop implementation notes

Main files likely touched:

- `frontend/packages/shared/src/routes.ts` — add optional trigger route param or new `agent-trigger` route;
- `frontend/apps/desktop/src/agents-client.ts` — add shared protocol imports and signed action helpers;
- `frontend/apps/desktop/src/models/agents.ts` — add React Query hooks/mutations for trigger CRUD;
- `frontend/apps/desktop/src/pages/agents.tsx` — add Triggers tab, dialog, detail state, breadcrumbs, and trigger
  session list.

Use the existing agent detail layout. Prefer one cohesive trigger section in `pages/agents.tsx` initially rather than
many tiny files, unless the UI becomes too large to read.

## Inspector and operations

Extend the built-in `/agents` inspector after the core feature works:

- list triggers per agent;
- show enabled state, last checked/fired/error;
- show recent firings and linked sessions;
- show activity monitor watermarks.

Add config for activity polling:

- enabled/disabled switch for trigger monitor, default enabled when triggers exist;
- poll interval;
- page size;
- max pages per poll;
- optional trusted-only mode for activity feed reads.

Logs should include trigger IDs and firing IDs, but must not log full prompts, session contents, provider secrets, or
signed request bodies.

## Security and privacy

- Trigger CRUD remains signed and account-scoped.
- A trigger should only be allowed to target resources/accounts the signer can reference under the existing account
  model. If the HM server lacks a direct authorization check, start with account-local triggers and document the
  limitation.
- Treat trigger prompts as session content: do not log them by default.
- Avoid creating sessions from untrusted remote activity unless the trigger explicitly allows that class of activity.
  Consider a `trustedOnly` trigger/source option.
- Add rate limits and per-trigger cooldowns before enabling broad site-update triggers in production, because a busy
  site could create many model sessions.

## Testing plan

Agents service tests:

- trigger CRUD ownership and validation;
- schema migration and idempotent `clientRequestId` behavior;
- matching for document comments, mentions, and site updates;
- first-run watermark baseline does not backfire old activity;
- repeated feed pages do not create duplicate firings/sessions;
- failed session creation records firing error and does not lose the event;
- disabled triggers do not fire;
- deleting a trigger stops future firings; current implementation keeps created sessions but removes deleted-trigger
  firing attribution.

Desktop tests or focused smoke coverage:

- Triggers tab appears on agent detail;
- New trigger dialog creates each trigger type;
- clicking a trigger updates breadcrumbs and opens the edit page;
- trigger detail lists sessions created by that trigger.

Manual smoke:

1. run the agents server and desktop;
2. create an agent and a document-comment trigger;
3. create a comment in the watched document;
4. verify the server records a firing, creates a session, and runs the agent;
5. open the trigger detail page and verify the session appears at the bottom.

## Phased rollout

### Phase 1: CRUD and UI shell

- Add protocol types/actions and SQLite tables. **Done for backend.**
- Add Triggers tab, New trigger dialog, edit page, and session list placeholder. **Done for initial desktop shell.**
- No background firing yet.

### Phase 2: Activity monitor MVP

- Add polling against ActivityFeed with persisted watermarks. **Initial monitor started.**
- Implement document-comment and user-mention matching. **Core matching utility started.**
- Create sessions from trigger firings. **Initial service path started.**
- Add interval, weekly, and one-time schedule trigger runtime. **Done.**
- Add idempotency tests.

### Phase 3: Site update triggers and operational hardening

- Add site/resource-prefix trigger support.
- Add cooldown/rate-limit controls. **Per-trigger cooldown started.**
- Improve trigger forms with account/site autocomplete for mention and site scopes. **Started.**
- Add inspector visibility and operational config. **Initial inspector visibility is in place.**
- Improve retry/backoff and error reporting.

### Phase 4: Polish and production readiness

- Add richer activity summaries in the UI.
- Add trusted-only controls and authorization checks.
- Add metrics/audit log.
- Revisit activity API cursor support if the HM server gains a stronger monotonic cursor.

## Open questions

- What is the canonical HM server endpoint/client package the Bun agents service should use for ActivityFeed polling?
- Does the activity feed provide a stable event ID beyond blob ID/CID and observe time, or should the agent server
  construct one?
- How should document URLs entered in the trigger dialog resolve to canonical resource IDs in a server-only context?
- Should trigger-created sessions immediately run the model, or should some trigger types create draft sessions awaiting
  user approval?
- What quota/cooldown defaults are safe for site-update triggers?
- Should triggers be exportable as part of an agent definition, or are they local server/account runtime state?
