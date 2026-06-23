# Desktop UI

The desktop app is the primary user-facing UI for Agents. The built-in `/agents` server UI is only for
inspection/debugging.

## Main files

- `frontend/apps/desktop/src/agents-client.ts`
- `frontend/apps/desktop/src/models/agents.ts`
- `frontend/apps/desktop/src/pages/agents.tsx`
- `frontend/apps/desktop/src/pages/agents/list.tsx`
- `frontend/apps/desktop/src/pages/agents/server.tsx`
- `frontend/apps/desktop/src/pages/agents/detail.tsx`
- `frontend/apps/desktop/src/pages/agents/session.tsx`
- `frontend/apps/desktop/src/pages/agents/dialogs.tsx`
- `frontend/apps/desktop/src/components/assistant-panel.tsx`
- `frontend/apps/desktop/src/pages/main.tsx`
- `frontend/apps/desktop/src/components/sidebar.tsx`
- `frontend/apps/desktop/src/app-menu.ts`
- `frontend/apps/desktop/src/app-windows.ts`
- `frontend/packages/shared/src/routes.ts`

## Routes

Route keys:

- `agents` — list/config page.
- `agent-server` — one configured server page, listing only agents hosted on that server plus server-scoped actions.
- `agent` — agent detail page.
- `agent-session` — session chat page.

`pages/main.tsx` dispatches these to separate lazy page modules under `frontend/apps/desktop/src/pages/agents/` instead
of routing all Agents views through one monolithic page component.

Agent routes are also exposed through the desktop omnibar as server HTTP URLs. An agent page uses
`<agent_server>/agents/<agent_id>`, and a session page uses `<agent_server>/agents/<agent_id>/sessions/<session_id>`.
Entering one of those URLs in the omnibar navigates back to the corresponding desktop Agents route.

## Entry points

Users can open Agents from:

- desktop sidebar;
- app menu;
- `Cmd/Ctrl + Shift + A`.

## Server settings

The Agents page is now a lightweight index. It shows configured agent servers with per-server health/model-provider
status and links to the shared **Secrets** and **Providers** dialogs. Clicking a server opens the `agent-server` page.
The index still includes an aggregated agent list for quick access across servers.

The server page lists agents hosted on that server and exposes the same shared server-scoped dialogs: Secrets for
server-side HM account keys and Providers for model-provider API keys. Agents data refreshes automatically through React
Query polling and WebSocket invalidations; there are no manual reload controls.

Advanced Settings includes an **AGENT SERVERS** section for managing multiple URLs and default selection.

Default local server:

```text
http://localhost:3050
```

## Provider dialog

Component:

```ts
ModelProvidersDialog
```

Features:

- list redacted providers;
- save OpenAI/Anthropic/Google provider records;
- save API key through signed `SetSecret`;
- save provider through signed `SetModelProvider`;
- reject remote plain-HTTP secret submission.

Caveat: Anthropic and Google providers are configuration-only until execution backends are added.

## Create-agent dialog

Component:

```ts
CreateAgentDialog
```

Features:

- choose the target agent server;
- choose configured provider for that server;
- set name;
- choose a model from the selected provider's remote model list;
- set system prompt with the same rich Seed block editor used by prompt/trigger editing;
- convert the rich prompt blocks to markdown before creating the signed `CreateAgent` request;
- create signed `CreateAgent` with `clientRequestId`.

New agents include `read` in `tools`, but the server also offers that tool regardless of saved definition. The current
plan is to augment this existing read tool for domain-aware SHM reads before deciding whether to expose a new `query`
alias.

## Agent detail page

Features:

- metadata/status display;
- document-style tabs: Sessions (default), Triggers, Tools, Prompt, and Settings;
- Sessions tab lists sessions and creates new sessions;
- Triggers tab lists agent-scoped triggers and creates new triggers;
- clicking a trigger keeps the user inside the agent page, shows Triggers breadcrumbs, and opens an editable trigger
  detail view;
- trigger detail shows operational metadata plus the sessions created by that trigger;
- Tools tab autosaves Seed-approved tool toggles and the uploaded HM account keys the agent may use for signing and
  publishing tools; the tool groups are the Seed read group (read/search/activity), the **web group**
  (`web_search`/`web_read`, which require server-side web backends), and the write group. Tool groups come from
  `frontend/apps/desktop/src/pages/agents/agent-tools.ts`;
- Tools tab offers a **New account** workflow that generates a server-side HM account key, publishes its profile, and
  creates an account home document stating that it is an agentic account;
- Prompt tab views/edits the main system prompt with the rich Seed block editor; prompt edits autosave when connected to
  the agent server, are converted to markdown before the signed `UpdateAgent` request, normalized by the server, and
  converted to model-facing markdown before execution;
- Settings tab edits agent name and chooses the model from the agent provider's remote model list, while showing
  provider/status/id;
- save via signed `UpdateAgent`;
- trigger CRUD via signed `ListAgentTriggers`, `GetAgentTrigger`, `CreateAgentTrigger`, `UpdateAgentTrigger`, and
  `DeleteAgentTrigger`;
- trigger creation/editing supports activity triggers and schedule triggers, including interval schedules, weekly
  day/time schedules, and one-time schedules;
- trigger creation/editing uses the rich Seed block editor for trigger prompts; trigger edits autosave, are converted to
  markdown before signed `CreateAgentTrigger` / `UpdateAgentTrigger` requests, and the server converts the normalized
  prompt to resolved markdown when creating a triggered session;
- trigger creation/editing includes an optional cooldown in minutes to reduce session storms;
- trigger enabled state defaults on for new triggers and autosaves immediately when toggled;
- document-comment trigger forms include document autocomplete/search while still allowing raw HM URLs;
- user-mention and site-update trigger forms include account/site autocomplete search while still allowing raw IDs/URLs;
- subscribe to `agents/<agentId>` for live updates.

## Session page

Features:

- back navigation to the owning agent detail page;
- agent header remains visible with the Sessions tab active while viewing a session, using the same shared header
  component as the agent detail page;
- inline editable session title with debounced signed `UpdateSession` saves; manual edits take precedence over hidden
  agent-generated title updates;
- system-prompt button in the session header opens a dialog with the current server-generated markdown system prompt
  that would be used if the session continued now;
- options menu in the session header with **Delete session**, confirmed through an alert dialog and backed by signed
  `DeleteSession`, returning to the agent's Sessions list after deletion;
- subtle title-save status dot: grey while saving, green after success, red after failure;
- durable event list;
- optimistic user message;
- full rich Seed block editor as the session chat composer, including slash-menu/editor features inherited from
  `CommentEditor`;
- session messages are converted from rich blocks to markdown before signed `MessageSession` submission while also
  sending the original rich block tree for durable session-history display; users submit from the rich editor with the
  send button or `Cmd/Ctrl+Enter`;
- queued messages while the agent is busy/streaming, using the shared chat queue UI from the assistant panel;
- signed `MessageSession` submission;
- signed `sessions/<sessionId>` WebSocket subscription;
- live assistant partial rendering;
- durable final assistant message rendering;
- automatic scroll-follow while the user is at the bottom, with a scroll-to-latest pill when the user scrolls up;
- visible tool call/result events rendered with the shared assistant chat bubbles;
- small thinking indicator while a message request is in flight or the durable session is streaming before partial text
  arrives;
- signed `StopSession` support from the stop button while streaming, including recovery for stale sessions stuck in
  `streaming` with no active runner.

## Shared chat rendering

Agents chat and the desktop assistant panel reuse the same message renderer:

```ts
ChatMessageBubble
AssistantMessageParts
```

Exported from:

```text
frontend/apps/desktop/src/components/assistant-message-rendering.tsx
```

Used in:

```text
frontend/apps/desktop/src/components/assistant-panel.tsx
frontend/apps/desktop/src/pages/agents.tsx
```

Benefits:

- same user and assistant bubble styling as the assistant panel;
- same markdown styling and GFM support for user and assistant message bubbles;
- an info button beside message bubbles that opens the exact markdown text visible to the LLM for that message plus a
  share URL of the form `<server>/agents/<agentId>/sessions/<sessionId>#event=<eventId>`;
- in-app `hm://` link handling;
- same streaming cursor treatment;
- same tool-call bubbles, including raw-debug details, richer `read` summaries that prefer document titles over raw
  `hm://` URLs, and richer write summaries/detail cards such as linked `Create document: <title>` rows for
  `document.create`;
- tool bubble selection is driven by the unified registry at `agents/protocol/src/tool-registry.ts`, shared with the
  model-facing tool descriptions and schemas.

## Automatic refresh

The desktop hooks in `frontend/apps/desktop/src/models/agents.ts` periodically refetch health, provider, agent-list,
agent-detail, and session queries for the active configured servers. Mutations invalidate the relevant `['agents', ...]`
query keys, and the WebSocket subscription hook updates or invalidates React Query caches when any configured server
emits live changes. The UI should not need manual refresh or reload buttons for normal Agents workflows.

## WebSocket hook

Hook:

```ts
useAgentWebSocketSubscription(serverUrl, accountUid, key, afterSeq)
```

Responsibilities:

- build WebSocket URL;
- sign `Subscribe` action;
- send CBOR envelope;
- parse JSON server events from string/Blob/ArrayBuffer;
- update React Query cache for durable appends;
- accumulate live partial text by session ID;
- keep partial visible until durable append arrives;
- reconnect with backoff.

Diagnostic logs are documented in [Operations](./operations.md) and
[WebSocket subscriptions](./websocket-subscriptions.md).

## Optimistic user messages

`addOptimisticSessionMessage()` inserts a temporary user event while the signed message request is in flight. When the
durable user event arrives, the hook removes matching optimistic events.

## Known UI gaps

- Provider deletion is missing.
- Secret rotation UX is minimal.
- `write` can use selected HM account keys to create drafts, profiles, documents, comments, capabilities, and contacts.
- Provider configuration does not clearly warn that Anthropic/Google execution is not implemented.
- No stop/cancel button exists.
- No provider test button exists.
- No model presets/capability validation beyond suggested defaults.

## Manual desktop smoke test

1. Start server.
2. Start desktop.
3. Open Agents.
4. Confirm health is online.
5. Save an OpenAI provider key.
6. Create an agent using that provider.
7. Open the agent detail page.
8. Create/open a session.
9. Send a message.
10. Confirm user message appears immediately.
11. Confirm assistant response streams as markdown.
12. Confirm final durable assistant message remains after refresh.
13. Ask the agent to read a Seed URL, including a clean HM web-domain URL when available.
14. Confirm tool call/result rows appear and show both the requested URL and resolved HM identity once rich rendering is
    implemented.
