---
name: Agent triggers plan
summary: "Status: Phase 1 CRUD and UI shell has started. Backend CRUD/persistence and the desktop Triggers tab/detail shell are in place. Phase 2 matching/idempotency…"
---
<!-- id:yswfEM4q -->
> **STATUS (2026-08-13): phases 1–3 shipped; the surface this plan designed is now scheduled for replacement.** <!-- id:55XjO7Xd -->

\> <!-- id:MpS7bxp4 -->
  > **Shipped and current:** the four sources (`schedule`, `document-comment`, `user-mention`, `site-update`), the <!-- id:1V7xs0FQ -->
  > `ActivityMonitor` with durable watermarks, exactly-once firing dedup through `trigger_firings.activity_key`, <!-- id:Jp2v0-fc -->
  > per-trigger cooldowns, trigger-created sessions, and the desktop Triggers tab. <!-- id:3uvboVj- -->

\> <!-- id:WrtUfsgM -->
  > **Added since, by the M6 first slice (the event bus underneath):** a fifth source, `run-completed`, firing inline from <!-- id:FebQ-KGr -->
  > run finalization; a **continuation** on every trigger (`agent_triggers.continuation_cbor`; NULL means `newThread`, <!-- id:VzF9zOoI -->
  > which is what every trigger in this plan did), with a `wake` continuation that delivers into a **parked run** through <!-- id:iDXhPwKr -->
  > the same transactional exactly-once path `SignalRun` uses; a firing-chain **loop guard** (`TRIGGER_CHAIN_MAX_HOPS`, 8 <!-- id:ascBF3g9 -->
  > hops) so two run-completed triggers cannot feed each other forever; and one shared `matchesActivityCriteria` matcher <!-- id:huvEhAPb -->
  > used by both trigger matching and run event waits. The desktop can render a `run-completed` trigger but cannot create <!-- id:jh6QZfnL -->
  > one — that is API-only today. <!-- id:53BVRwd1 -->

\> <!-- id:D2tpg4fu -->
  > **Added 2026-08-18 (introspection slice):** the `~/triggers/` verb surface now exists **on the existing** <!-- id:HLWYn-_q -->
  > `agent_triggers` rows** — `read ~/triggers/` lists (with the write contract inline), `read ~/triggers/<name>` returns** <!-- id:f-skHXpY -->
  > one trigger plus recent firings, and `write ~/triggers/<name>` creates/edits/enables/disables/deletes by name (or id), <!-- id:NPv-qEMp -->
  > honoring `enabled` as written. There is **no draft/consent step**: the owner decided (2026-08-19) that agents manage <!-- id:U3L154wU -->
  > their own triggers directly, so "do this every morning" works in one turn (see `security.md` for the threat-model <!-- id:p3jaimUH -->
  > note). <!-- id:-HCO16l6 -->

\> <!-- id:jrVTF_8U -->
  > **Added 2026-08-30 (headless continuations):** two more continuation kinds, `tool` and `script`, run a firing with no <!-- id:atBek9ZM -->
  > model involved — one tool call, or a workflow script — as a `workflow` run linked from `trigger_firings.run_id`, with <!-- id:n17Pbq8D -->
  > optional `onFailure: 'thread'` escalation into the ordinary trigger thread. See `trigger-continuations.md`. <!-- id:Sa6T2yTI -->

\> <!-- id:o_iAE0N3 -->
  > **Superseded but not yet built:** trigger **documents** (content-addressed, CID-versioned like `~/tools/`), replacing <!-- id:ri9LWQm1 -->
  > the `CreateAgentTrigger`/`UpdateAgentTrigger`/`DeleteAgentTrigger` actions. That, the `document-change` source, the <!-- id:tQo50RrQ -->
  > `appendTo`/`runPlan` continuations, the data-preserving migration off `agent_triggers`, and the desktop editor <!-- id:7Timzf0e -->
  > replacing the CRUD dialogs are designed in `harness/m6-event-bus-design.md` and **not implemented** (its draft→active <!-- id:3A98oKwF -->
  > consent proposal is explicitly not wanted). Until they are, the CRUD actions in "Signed API changes" below remain the <!-- id:KH_PCpEn -->
  > desktop's interface, now alongside the verb surface. <!-- id:Smrv2FaR -->

Status: Phase 1 CRUD and UI shell has started. Backend CRUD/persistence and the desktop Triggers tab/detail shell are in place. Phase 2 matching/idempotency utilities and background ActivityFeed polling have started. Schedule triggers are now implemented with interval, weekly, and one-time modes plus a background schedule monitor. Recent fix: first ActivityFeed poll now processes events observed after trigger creation instead of dropping them into the baseline. <!-- id:mRYzgSYp -->

This plan describes the first product and engineering pass for **agent triggers**: saved rules that watch Seed activity and automatically create a new agent session with a configured prompt when matching activity occurs. <!-- id:qNVp_bak -->

# Product goal <!-- id:zDGJRb7K -->

Agent triggers let an account owner attach proactive workflows to an existing agent. A trigger belongs to one agent and defines: <!-- id:lYhw4wZR -->
  - **when** the trigger should fire, expressed as a trigger source/filter such as a comment in a document, a mention of a user, or new activity within a site; <!-- id:txCVZIrf -->
  - **what prompt** should start the session when it fires; <!-- id:Sn8GDtij -->
  - **how to manage sessions** created by prior firings. <!-- id:VU6a8X7X -->

The first release should feel like part of the existing agent detail page, not like a separate automation product. <!-- id:PmUBEERG -->

# User experience <!-- id:pYeCwL0i -->

## Agent page navigation <!-- id:_0wkBs0J -->

Add a new **Triggers** tab to the agent detail page, beside the existing Sessions, Prompt, and Settings tabs. <!-- id:F4878ZTo -->

The Triggers tab has two states: <!-- id:lboFbvKD -->
  1. **Trigger list** — shows all triggers saved for the agent, plus a **New trigger** button. <!-- id:i5hIipKA -->
  2. **Trigger detail** — shown after clicking a trigger. The user remains within the agent page header and Triggers tab, with breadcrumbs such as: <!-- id:15tgnuX3 -->

```text <!-- id:SfoU5g3D -->
Agents / Research Agent / Triggers / Comments on launch spec
```

The trigger detail page should be addressable by route so refresh/deep-link preserves the selected trigger. <!-- id:q4aPPONE -->

## New trigger dialog <!-- id:TNiFsddH -->

The **New trigger** button opens a dialog that creates each trigger. The dialog should collect the minimum viable fields: <!-- id:zlLmaqbu -->
  - name; <!-- id:EaaVbxlQ -->
  - enabled/disabled state, default enabled; <!-- id:Qy1rDgYG -->
  - trigger type; <!-- id:1-bZDnZX -->
  - type-specific filters; <!-- id:IW_hirkC -->
  - prompt to use when a session is created. <!-- id:xeR2q5AD -->

Initial trigger types: <!-- id:xH5xO0CY -->
  1. **Comment in a document** <!-- id:zAg5qRd2 -->
     - document/resource ID or URL; <!-- id:a16XXQQz -->
     - optional author filter; <!-- id:jDvucnLk -->
     - fires when a new comment appears for that document. <!-- id:3U_Tab0L -->
  2. **User mention** <!-- id:80_PnQEM -->
     - mentioned account/user ID; <!-- id:kvc-6O8v -->
     - optional resource/site filter; <!-- id:5EkFrmof -->
     - fires when activity reports a matching mention. <!-- id:h_rgppcS -->
  3. **Site update** <!-- id:iDDXsY_o -->
     - site/account/domain/resource-prefix selector; <!-- id:hwi7hV10 -->
     - optional event-type filter, initially `doc-update` and `comment`; <!-- id:PKxRjqZ9 -->
     - fires when new matching activity appears within that site scope. <!-- id:U7_BRmt4 -->
  4. **Schedule** <!-- id:vKQaDGJb -->
     - every \* hours/minutes OR <!-- id:KZzab5ui -->
     - daily, allow the user to choose the time of day, which days of the week <!-- id:H0xKSWyR -->
     - ONCE: date picker for exactly when to trigger <!-- id:nquDB7-8 -->

The prompt field should explain that runtime context will be added by the server. Example placeholder: <!-- id:XDmzPW7w -->

```text <!-- id:w2kkBorC -->
A new comment was added to the launch spec. Read the document and comment, summarize what changed, and create a useful reply comment.
```

## Trigger detail page <!-- id:jDWHFRdx -->

Clicking a trigger opens an editable detail page with: <!-- id:_wLsTtHs -->
  - name; <!-- id:OLGxSa6Q -->
  - enabled/disabled toggle; <!-- id:QzsuYvTi -->
  - trigger type and filters; <!-- id:oE3KWfwC -->
  - prompt; <!-- id:mpXwfQu4 -->
  - operational metadata: created time, updated time, last checked time, last fired time, last error; <!-- id:Go5TklTt -->
  - save/delete controls; <!-- id:My-ATv6d -->
  - a bottom section listing sessions created by this trigger. <!-- id:ptURSvy_ -->

The sessions list should show the same core session fields used in the Sessions tab, plus firing metadata: <!-- id:5F_mSdzy -->
  - session title; <!-- id:fe5sc1Qm -->
  - status; <!-- id:AV24J8Xv -->
  - created time; <!-- id:0my23VR_ -->
  - matching activity summary; <!-- id:1heV0--Y -->
  - link to the session page. <!-- id:44v26vF_ -->

# Data model <!-- id:LgU4yD8R -->

Add agent-scoped trigger storage. Suggested protocol shape: <!-- id:FmjFL4oW -->

```ts <!-- id:4cNnuqHr -->
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

Persist triggers in a new `agent_triggers` table: <!-- id:nxjH9UwC -->
  - `id` primary key; <!-- id:Dq-Xy45D -->
  - `account_id`; <!-- id:z_TpaHqC -->
  - `agent_id`; <!-- id:yjA83RyR -->
  - `enabled`; <!-- id:xBJMF3Lw -->
  - `name`; <!-- id:7-Cwfh7C -->
  - `source_cbor`; <!-- id:ydXFhFox -->
  - `prompt`; <!-- id:MOH9zVPW -->
  - `created_at`; <!-- id:3KKBHk4q -->
  - `updated_at`; <!-- id:cKVsj-4S -->
  - `last_checked_at`; <!-- id:-UvCll67 -->
  - `last_fired_at`; <!-- id:16LIMs7h -->
  - `last_error`. <!-- id:JsoqKEzH -->

Track created sessions with explicit trigger firing records instead of only storing `trigger_id` on sessions. Suggested table: <!-- id:F8kqrWT0 -->
  - `trigger_firings` <!-- id:NkVpddfe -->
    - `id` primary key; <!-- id:P3EKm1Vh -->
    - `account_id`; <!-- id:XYOZPp14 -->
    - `agent_id`; <!-- id:Jgfdy7UI -->
    - `trigger_id`; <!-- id:vT8Wu3BT -->
    - `activity_key` unique per trigger; <!-- id:xJymaP6Z -->
    - `session_id` nullable until session creation succeeds; <!-- id:zXbtF64Y -->
    - `activity_cbor` summary of the matched feed event; <!-- id:-EVBVswo -->
    - `status` (`created`, `skipped`, `error`); <!-- id:6EeywGwE -->
    - `error`; <!-- id:jgzYAYZE -->
    - `created_at`. <!-- id:7--QBjhi -->

The `activity_key` must be stable and derived from the feed event identity, for example event type plus blob ID/CID/resource/observe time as available. Add a uniqueness constraint on `(account_id, trigger_id, activity_key)` so feed retries are idempotent. <!-- id:O5Al90bc -->
  > **Comment mentions emit two sibling feed events.** A comment that @mentions an account produces both a `comment` event <!-- id:p0uaNIcI -->
  > (`feedEventId: blob-<cid>`) and a comment-sourced `citation` event (`feedEventId: mention-<cid>--<target>`) that share <!-- id:NRGJIlSx -->
  > the same comment-version CID. They are indexed seconds apart and can land in different polls, and the staleness <!-- id:UuppPJsn -->
  > watermark can drop whichever arrives second. Both are therefore allowed to match (`matchesSingleMention` no longer <!-- id:-m5Yf_DA -->
  > suppresses `citationType: 'c'`), and `activityTriggers.activityFiringKey` collapses the citation onto its comment <!-- id:pngDC2Rq -->
  > sibling's `blob-<cid>` identity before the `trigger_firings` insert — so the mention fires **exactly once** regardless <!-- id:1jCfPxPN -->
  > of which sibling is processed first, and survives the other being dropped. Both resolved siblings carry the full <!-- id:Vnqxw-rc -->
  > comment body (`loadCitationEvent` fetches it for `'c'` citations), so context is preserved whichever one fires. <!-- id:OweioH8J -->
  > Regression coverage: `src/activity-trigger-race.test.ts` (real monitor → HTTP → service) and <!-- id:g3eIJsvR -->
  > `scripts/smoke-trigger.ts` (`bun run test:trigger`, real daemon). <!-- id:dOBKzCTh -->

Track feed progress separately from individual triggers: <!-- id:iWFT3O_h -->
  - `activity_watermarks` <!-- id:opWi0Mhb -->
    - `account_id`; <!-- id:GY5hnRjU -->
    - `server_url` or HM source ID; <!-- id:keGHA3gi -->
    - `cursor` or compound watermark payload; <!-- id:luJRNQl9 -->
    - `last_poll_at`; <!-- id:0ekUtbhQ -->
    - `last_success_at`; <!-- id:EChNi-RL -->
    - `last_error`. <!-- id:0xvBkdmJ -->

Because the current activity API is newest-first and page-token based, the first implementation should store a conservative high-water mark based on observed event identity and time rather than assuming a single monotonic offset exists. <!-- id:3e9BpG5m -->

# Signed API changes <!-- id:Gi3p_-S_ -->

Add actions to `agents/protocol/src/index.ts` and handle them in `agents/src/api-service.ts`: <!-- id:D9EEe9JF -->
  - `ListAgentTriggers {agentId}` → `ListAgentTriggersResponse {triggers}`; <!-- id:6oLzrMBm -->
  - `GetAgentTrigger {triggerId}` → `GetAgentTriggerResponse {trigger, sessions}`; <!-- id:dWA7OLh2 -->
  - `CreateAgentTrigger {agentId, trigger, clientRequestId?}` → `CreateAgentTriggerResponse {trigger}`; <!-- id:1_721kzr -->
  - `UpdateAgentTrigger {triggerId, patch}` → `UpdateAgentTriggerResponse {trigger}`; <!-- id:0z80G13v -->
  - `DeleteAgentTrigger {triggerId}` → `DeleteAgentTriggerResponse {triggerId}`. <!-- id:Cdh7AcWB -->

Ownership checks must always verify `(account_id, agent_id, trigger_id)` relationships. Trigger actions should follow the existing signed CBOR API and idempotency patterns. <!-- id:3W5TTYf4 -->

Update WebSocket broadcasts so changes to triggers invalidate: <!-- id:oD61Gf2L -->
  - the account agent list if summary counts are shown; <!-- id:b8Fwqv4i -->
  - `agents/<agentId>` detail; <!-- id:ak2zs0SC -->
  - a future `agent-triggers/<agentId>` subscription key, if added. <!-- id:M-jmoPd6 -->

# Server runtime design <!-- id:dP8FB6qZ -->

The agent server is responsible for reliable trigger execution. Desktop should only manage trigger CRUD. <!-- id:YMM0Qilf -->

## Activity monitor <!-- id:dZ-7cMJ0 -->

Add a background activity monitor inside the agents service that: <!-- id:fSVX4_sr -->
  1. discovers accounts with at least one enabled trigger; <!-- id:jrKeRW9k -->
  2. polls the HM server ActivityFeed for those accounts/scopes; <!-- id:bEfUuEnB -->
  3. pages backward from newest activity until it reaches known events/watermarks; <!-- id:In9wGzHN -->
  4. evaluates enabled triggers against each new event in chronological order; <!-- id:YmOxV2PA -->
  5. inserts a `trigger_firings` row before creating a session; <!-- id:mxTy_Zj5 -->
  6. creates a session and sends the configured prompt when a trigger matches; <!-- id:WcA5VpmY -->
  7. updates firing status, trigger metadata, and the activity watermark. <!-- id:-BotVV1v -->

Avoid firing triggers during startup before the server has established a baseline. On first run for an account/server, store the current feed head as the watermark and only fire on future activity unless an explicit backfill mode is added later. <!-- id:U1FAmZrP -->

## Matching rules <!-- id:t6Qdmduo -->

Keep matching simple and transparent in the first release: <!-- id:uUJXrADT -->
  - `document-comment`: match `NewBlobEvent.blob_type == 'Comment'` and exact resource ID, or resource-prefix match if comments use target-specific resource IDs; <!-- id:4MoTMCfM -->
  - `user-mention`: match `Event.new_mention` where the mentioned account equals the trigger target; <!-- id:GM73ZPoW -->
  - `site-update`: match resource prefix and selected feed event types, initially `doc-update` and `comment`. Legacy low-level blob type filters such as `Ref`, `Change`, and `Comment` are still accepted as aliases where possible. <!-- id:3PUcAivT -->

Normalize user-entered URLs/resource IDs at the API boundary when triggers are created or updated. Store canonical resource IDs/prefixes so internal matching can compare exact strings. <!-- id:7sI_RcEf -->

## Session creation <!-- id:HyEcSHD_ -->

A trigger firing creates a normal session for the owning agent. The initial user message should include: <!-- id:dHNCmluy -->
  - the trigger prompt; <!-- id:mVthssms -->
  - a compact machine-readable context block containing trigger ID, firing ID, activity type, resource, author/account, timestamps, and relevant CIDs/blob IDs; <!-- id:CLzxUIBp -->
  - enough links/IDs for the agent to call `read` for full context. <!-- id:n_Dp4gxJ -->

Suggested session title format: <!-- id:uph_MF0r -->

```text <!-- id:udTAvoEo -->
<Trigger name> — <short activity summary>
```

Add session metadata or a firing table join so the UI can list sessions created by a trigger without parsing messages. <!-- id:RagMzQXi -->

## Reliability and concurrency <!-- id:Y8cJRQHl -->

Requirements: <!-- id:TBN2hvlt -->
  - evaluate each activity event at most once per trigger using the `(trigger_id, activity_key)` uniqueness constraint; <!-- id:_9TeJTme -->
  - do not advance the account/server watermark past events that failed before they were recorded; <!-- id:QoHzMk_u -->
  - process events in deterministic chronological order after fetching newest-first pages; <!-- id:Jik6G6uO -->
  - use a per-account monitor lock so two loops do not race in the same process; <!-- id:HZGLoq9x -->
  - tolerate process restarts by recovering from persisted watermarks and firing records; <!-- id:ZJ26BVjD -->
  - retry transient HM server/model-provider failures with bounded backoff; <!-- id:VxWN_ZoL -->
  - record permanent trigger errors on the trigger and firing records. <!-- id:yRqb9ZPE -->

Do not use sleeps to fix races. Poll intervals and backoff are acceptable as scheduling, but correctness must come from durable watermarks and idempotency constraints. <!-- id:1OYRyT3R -->

# Desktop implementation notes <!-- id:B00fo0FF -->

Main files likely touched: <!-- id:Vy5RrHF8 -->
  - `frontend/packages/shared/src/routes.ts` — add optional trigger route param or new `agent-trigger` route; <!-- id:bS1Wy_v9 -->
  - `frontend/apps/desktop/src/agents-client.ts` — add shared protocol imports and signed action helpers; <!-- id:eCCHf3UP -->
  - `frontend/apps/desktop/src/models/agents.ts` — add React Query hooks/mutations for trigger CRUD; <!-- id:AUg5K2Bi -->
  - `frontend/apps/desktop/src/pages/agents.tsx` — add Triggers tab, dialog, detail state, breadcrumbs, and trigger session list. <!-- id:H9piGtVs -->

Use the existing agent detail layout. Prefer one cohesive trigger section in `pages/agents.tsx` initially rather than many tiny files, unless the UI becomes too large to read. <!-- id:XU2Uti9q -->

# Inspector and operations <!-- id:Oz9Secfg -->

Extend the built-in `/agents` inspector after the core feature works: <!-- id:aHV1eigf -->
  - list triggers per agent; <!-- id:UnBlq_xc -->
  - show enabled state, last checked/fired/error; <!-- id:UD1oIZ-O -->
  - show recent firings and linked sessions; <!-- id:5zqODZI7 -->
  - show activity monitor watermarks. <!-- id:Xb6ZZNCT -->

Add config for activity polling: <!-- id:nj-kmwbZ -->
  - enabled/disabled switch for trigger monitor, default enabled when triggers exist; <!-- id:NBuZWS3U -->
  - poll interval; <!-- id:K9qksQPe -->
  - page size; <!-- id:J5QzuwfM -->
  - max pages per poll; <!-- id:70iPh_dF -->
  - optional trusted-only mode for activity feed reads. <!-- id:TZHzcSfS -->

Logs should include trigger IDs and firing IDs, but must not log full prompts, session contents, provider secrets, or signed request bodies. <!-- id:23sVVcXQ -->

# Security and privacy <!-- id:EueMpwL_ -->

- Trigger CRUD remains signed and account-scoped. <!-- id:EaWfoJWO -->
- A trigger should only be allowed to target resources/accounts the signer can reference under the existing account model. If the HM server lacks a direct authorization check, start with account-local triggers and document the limitation. <!-- id:U5zclOxJ -->
- Treat trigger prompts as session content: do not log them by default. <!-- id:MYWbE-ai -->
- Avoid creating sessions from untrusted remote activity unless the trigger explicitly allows that class of activity. Consider a `trustedOnly` trigger/source option. <!-- id:q1klw-60 -->
- Add rate limits and per-trigger cooldowns before enabling broad site-update triggers in production, because a busy site could create many model sessions. <!-- id:LA1quXtF -->

# Testing plan <!-- id:QFd594Aw -->

Agents service tests: <!-- id:4PuFccpl -->
  - trigger CRUD ownership and validation; <!-- id:Lk0GcAqj -->
  - schema migration and idempotent `clientRequestId` behavior; <!-- id:KxXiNAJE -->
  - matching for document comments, mentions, and site updates; <!-- id:SvT5Acwr -->
  - first-run watermark baseline does not backfire old activity; <!-- id:AGeYKEND -->
  - repeated feed pages do not create duplicate firings/sessions; <!-- id:-xNo93rF -->
  - failed session creation records firing error and does not lose the event; <!-- id:90cXVybz -->
  - disabled triggers do not fire; <!-- id:wAJ_frFo -->
  - deleting a trigger stops future firings; current implementation keeps created sessions but removes deleted-trigger firing attribution. <!-- id:6XPsifNm -->

Desktop tests or focused smoke coverage: <!-- id:uX6FRiCL -->
  - Triggers tab appears on agent detail; <!-- id:gPK0R2ki -->
  - New trigger dialog creates each trigger type; <!-- id:vY0kTsF- -->
  - clicking a trigger updates breadcrumbs and opens the edit page; <!-- id:Fs-P1d_U -->
  - trigger detail lists sessions created by that trigger. <!-- id:-qJQhFs2 -->

Manual smoke: <!-- id:hbAIZw9x -->
  1. run the agents server and desktop; <!-- id:kzl1AcIt -->
  2. create an agent and a document-comment trigger; <!-- id:pQvEHeF8 -->
  3. create a comment in the watched document; <!-- id:n12uGtN2 -->
  4. verify the server records a firing, creates a session, and runs the agent; <!-- id:JzaCGmBF -->
  5. open the trigger detail page and verify the session appears at the bottom. <!-- id:S5hKEHZf -->

# Phased rollout <!-- id:UifyHYpj -->

## Phase 1: CRUD and UI shell <!-- id:NVv7L5R3 -->

- Add protocol types/actions and SQLite tables. **Done for backend.** <!-- id:SVaeUHVQ -->
- Add Triggers tab, New trigger dialog, edit page, and session list placeholder. **Done for initial desktop shell.** <!-- id:YYd-mFai -->
- No background firing yet. <!-- id:bM2Qoz26 -->

## Phase 2: Activity monitor MVP <!-- id:z1-R7nnx -->

- Add polling against ActivityFeed with persisted watermarks. **Initial monitor started.** <!-- id:FpLqV_HR -->
- Implement document-comment and user-mention matching. **Core matching utility started.** <!-- id:XEY5t4uZ -->
- Create sessions from trigger firings. **Initial service path started.** <!-- id:vuZ_mFMI -->
- Add interval, weekly, and one-time schedule trigger runtime. **Done.** <!-- id:Gy_5WgCg -->
- Add idempotency tests. <!-- id:A-xYsNMT -->

## Phase 3: Site update triggers and operational hardening <!-- id:ITmveBdh -->

- Add site/resource-prefix trigger support. <!-- id:r0XzSjkH -->
- Add cooldown/rate-limit controls. **Per-trigger cooldown started.** <!-- id:mTV_CVYi -->
- Improve trigger forms with account/site autocomplete for mention and site scopes. **Started.** <!-- id:BBjn6Bvy -->
- Add inspector visibility and operational config. **Initial inspector visibility is in place.** <!-- id:_vyxVsvz -->
- Improve retry/backoff and error reporting. <!-- id:ogPe7GcS -->

## Phase 4: Polish and production readiness <!-- id:mibAqlf_ -->

- Add richer activity summaries in the UI. <!-- id:FI7y1x_5 -->
- Add trusted-only controls and authorization checks. <!-- id:KbAhbSVa -->
- Add metrics/audit log. <!-- id:PbcOrPnE -->
- Revisit activity API cursor support if the HM server gains a stronger monotonic cursor. <!-- id:4V-kMf44 -->

# Open questions <!-- id:KDsa53jS -->

- What is the canonical HM server endpoint/client package the Bun agents service should use for ActivityFeed polling? <!-- id:HsJ-OO2K -->
- Does the activity feed provide a stable event ID beyond blob ID/CID and observe time, or should the agent server construct one? <!-- id:6Jo4-SOE -->
- How should document URLs entered in the trigger dialog resolve to canonical resource IDs in a server-only context? <!-- id:mQGF7KxX -->
- Should trigger-created sessions immediately run the model, or should some trigger types create draft sessions awaiting user approval? <!-- id:7tsdCmbj -->
- What quota/cooldown defaults are safe for site-update triggers? <!-- id:4ywT9xAA -->
- Should triggers be exportable as part of an agent definition, or are they local server/account runtime state? <!-- id:6Ts21KD6 -->
