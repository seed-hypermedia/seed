# Desktop UI

The desktop app is the primary user-facing UI for Agents; the server itself has no browser UI.

Two surfaces read the same sessions: the **Agents pages** (full-window) and the **Assistant sidebar** (a compact session
view over the same service). Both render from the shared message renderer and the shared tool registry, so a tool row
looks the same wherever it is read.

## Main files

- `frontend/apps/desktop/src/agents-client.ts` — signed action client and the protocol re-exports.
- `frontend/apps/desktop/src/models/agents.ts` — every React Query hook and the signed WebSocket subscriptions.
- `frontend/apps/desktop/src/models/agent-session-rows.ts` — turns durable events into chat rows (actors, tool pairing,
  run interleaving).
- `frontend/apps/desktop/src/models/event-meta.ts` — the per-event provenance rows shown in info dialogs.
- `frontend/apps/desktop/src/models/local-assistant.ts` — auto-provisioning for the built-in Assistant agent.
- `frontend/apps/desktop/src/pages/agents.tsx` and `pages/agents/` — the page modules (see below).
- `frontend/apps/desktop/src/components/assistant-panel.tsx` — the sidebar.
- `frontend/apps/desktop/src/components/assistant-message-rendering.tsx` — the shared bubbles.
- `frontend/apps/desktop/src/components/assistant-window-context.ts` — the `## Current window` context lines.
- `frontend/packages/shared/src/routes.ts` — route schemas.

Page modules under `frontend/apps/desktop/src/pages/agents/`:

| file                                                                                                                                                    | what it is                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `list.tsx`                                                                                                                                              | the Agents index: configured servers, aggregated agent list               |
| `server.tsx`                                                                                                                                            | one configured server: its agents plus server-scoped dialogs              |
| `detail.tsx`                                                                                                                                            | agent detail page and all six tabs                                        |
| `session.tsx`                                                                                                                                           | the session (thread) page                                                 |
| `header.tsx`                                                                                                                                            | the shared agent header and tab bar                                       |
| `agent-row.tsx`, `agent-name.ts`                                                                                                                        | agent list row and name helpers                                           |
| `dialogs.tsx`                                                                                                                                           | create-agent, model providers, agent accounts, delete confirmations       |
| `memory.tsx`                                                                                                                                            | the Memory tab file browser/editor                                        |
| `agent-tools.ts`                                                                                                                                        | the grant names, defaults, and server-capability gating                   |
| `user-tool-palette.tsx`                                                                                                                                 | the wrench palette — the user's own verbs                                 |
| `run-card.tsx`                                                                                                                                          | the pinned run card and its frozen transcript twin                        |
| `run-work.tsx`                                                                                                                                          | the plan/children/tool-call body shared by both cards                     |
| `run-parked-actions.tsx`                                                                                                                                | Answer / Resume for a parked run                                          |
| `trigger-types.tsx`                                                                                                                                     | per-trigger-type forms, summaries, and the triggered-session context card |
| `model-select.tsx`, `model-utils.ts`, `provider-select.tsx`, `provider-registry.ts`, `provider-icons.tsx`, `provider-oauth.tsx`, `reasoning-select.tsx` | model/provider pickers, logos, OAuth sign-in, reasoning level             |
| `prompt-editor.tsx`                                                                                                                                     | the Seed block editor wrapper for prompts                                 |
| `no-account.tsx`                                                                                                                                        | the empty state when no account is selected                               |

The shared-UI move to `@shm/ui/agents` is **not** on this branch: the desktop still owns these components directly.

## Routes

- `agents` — index page.
- `agent-server` — one configured server (`serverUrl`).
- `agent` — agent detail, with `tab` (`sessions` | `triggers` | `memory` | `tools` | `prompt` | `settings`),
  `triggerId`, and `memoryPath` so a `~/memory/…` link in a tool row lands on that exact file.
- `agent-session` — the session chat page.

Agent routes are also addressable through the omnibar as server HTTP URLs: `<agent_server>/agents/<agent_id>` and
`<agent_server>/agents/<agent_id>/sessions/<session_id>`.

Entry points: desktop sidebar, app menu, `Cmd/Ctrl + Shift + A`.

## The built-in Assistant

The sidebar assistant is not a separate runtime — it is an ordinary agent named **Assistant**, auto-provisioned on the
local server once a model provider exists (`models/local-assistant.ts`). It is created with a deterministic idempotency
key (`local-assistant-bootstrap-v1`) so two windows racing on first launch dedupe server-side, and so deleting it is
respected rather than undone on next launch. Its callable grant is search only; the verbs cover reading and memory, and
with no signing key `hm://` publishing stays blocked.

The panel runs the same components as the full session page in `compact` mode — `ChatMessageBubble` /
`AssistantMessageParts` / `AgentErrorRow` from the shared renderer, `buildAgentSessionChatRows` + `frozenRunIds` from
the same row model, and `SessionRunCard` / `RunRecordCard` from `pages/agents/run-card`. It does **not** mount the
wrench palette: user verbs are a full-session affordance.

The panel contributes **window context**: `formatWindowContextLines()` builds a `## Current window` block (URL, title,
view, side panel, open comment, focused block and range, draft state) that rides along as a `context` content part on
the **first** message only. It never appears in the visible transcript; it surfaces as a "Context" chip on the user
bubble that opens the exact lines the model was given.

## Server settings and dialogs

The Agents index shows an **Invites** section when the selected account has pending agent invitations, with Accept and
Decline actions. Accepting opens the agent; accepted shared agents then appear in **All Agents** with a reader/writer
badge.

The Agents index has two sections: **Agent Servers** (agents grouped by server, each with per-server **Accounts** and
**Providers** buttons opening `ManageAgentAccountsDialog` and `ModelProvidersDialog`) and **All Agents**, the aggregated
list across servers with Create Agent. Health reads "Checking… / Offline / Online", and the status dot is suppressed for
the local server unless it is actually erroring (`list.tsx:83`) — the local server is part of the app, so an "online"
light on it is noise, while a failure is a real problem.

Clicking a server opens the `agent-server` page, a thin route that lists that server's agents and exposes the same two
dialogs. Both it and the index render `AgentsNoAccountPage` when no account is selected, because agent servers reject
unauthenticated requests — including the local one.

Data refreshes through React Query polling and WebSocket invalidations; there are no manual reload controls.

Advanced Settings has an **AGENT SERVERS** section for managing multiple URLs and the default selection. Default local
server in dev is `http://localhost:3051`; release builds use port 3050.

### Provider dialog

`ModelProvidersDialog` (`dialogs.tsx`) lists redacted providers with their logos and saves records for every type in
`provider-registry.ts`. Two auth modes:

- **API key** — saved through signed `SetSecret`, then `SetModelProvider` referencing the secret name. The dialog
  refuses to send a key to a remote plain-HTTP server, but only when a key is actually being sent.
- **Subscription sign-in** ("Sign in with ChatGPT") — offered only when the provider metadata declares it **and** the
  server's health reports `subscriptionAuth: true`, because the flow needs this desktop app to catch the provider's
  localhost redirect. A provider whose sign-in expired shows `authStatus: 'needs-login'` with a re-sign-in button, and
  an explicit message when the server has since stopped offering the flow.

An editable **Base URL** field appears for `ollama`/`custom` (prefilled from `PROVIDER_METADATA.defaultBaseUrl`), and
the API key is optional for those keyless local providers.

### Create-agent dialog

`CreateAgentDialog` (`dialogs.tsx`): choose server and provider, name the agent, pick a model from the provider's remote
model list, pick a reasoning level where the model supports one, and write the system prompt in the same Seed block
editor used everywhere else. Prompt blocks are converted to markdown before the signed `CreateAgent` request, which
carries a `clientRequestId`.

New agents are created with `DEFAULT_AGENT_TOOLS` — `search`, `web_search`, `execute`, and the `publish` grant
(`agent-tools.ts:19`). The five verbs are not in that list because they are not configuration.

The dialog creates a dedicated signing identity (HM account) for the agent first; the server then auto-creates a default
enabled `user-mention` trigger following that identity, so mentioning the agent's account starts a session immediately.

## Agent detail page

Tabs: **Sessions** (default), **Triggers**, **Memory**, **Tools**, **Prompt**, **Settings** (`header.tsx:201`).

- **Sessions** lists sessions and creates new ones, nesting child sessions under their parents.
- **Triggers** lists agent-scoped triggers and creates them; clicking one stays inside the agent page with Triggers
  breadcrumbs and an editable detail view showing operational metadata plus the sessions that trigger created. Forms
  cover activity and schedule triggers (interval, weekly day/time, one-time), an optional cooldown in minutes, document
  autocomplete for comment triggers, account/site autocomplete for mention and site-update triggers, rich block editing
  for trigger prompts, and autosave on every edit including the enabled toggle. Per-type logic lives in
  `trigger-types.tsx` so the forms and the session UI cannot drift. Agents can also create, edit, enable, disable, and
  delete their own triggers via `write ~/triggers/<name>`; the list refreshes live from `trigger-updated` account
  events, so agent-made changes appear immediately.
- **Memory** (`memory.tsx`) browses and edits `~/memory`: entry list with sizes and per-row delete (two-step inline
  confirm), a monospace editor with dirty-state Save/Revert for text files, inline image/audio/video previews, per-file
  download, **Add file** upload, a **From URL** server-side download form, a **New file** form accepting nested paths,
  and **Publish to IPFS** with a copyable `ipfs://<cid>`. Files can be dragged onto the list (root) or onto a folder row
  (into that folder), with drop-target highlighting. Files over `MAX_MEMORY_PREVIEW_BYTES` (32 MB, `memory.tsx:36`) skip
  the inline preview and offer download only. It refreshes live from `agent-memory-changed` events, so a sandbox run
  writing files updates the tab as it happens. The `agent` route carries `memoryPath`, so a `~/memory/…` link in a tool
  row deep-links to the file.
- **Prompt** edits the system prompt with the Seed block editor; edits autosave, convert to markdown before the signed
  `UpdateAgent`, and are normalized server-side.
- **Settings** edits the name, model, and reasoning level and manages agent collaborators. Owners get the same
  account-search invite control used by document collaborators, with a read/write role picker; the member list includes
  pending invitations and supports role changes, cancellation, and revocation. Readers see the agent in read-only mode;
  writers can edit/interact but cannot manage collaborators or delete the agent.

Shared conversation identity reaches the model as well as the UI. The runtime builds a current member roster with each
accepted participant's role, stable Seed account ID, and profile display name when resolvable. Every signed human chat
message is replayed with a runtime-authored `<message_sender>` account prefix, so the agent keeps different people's
requests and preferences distinct even when a profile is unavailable.

### Tools tab

Four compact toggle rows configure the grant set (`detail.tsx`); verbs and authored tools are not grants:

| toggle               | grant                                                                                |
| -------------------- | ------------------------------------------------------------------------------------ |
| Search Seed content  | `search`                                                                             |
| Search the web       | `web_search`                                                                         |
| Execute code         | `execute`                                                                            |
| Publish Seed content | `publish` — signed public documents, comments, and IPFS; private memory is always on |

Toggles autosave. Stored definitions are read through `normalizeStoredAgentTools()` (`agent-tools.ts:32`), which maps
`execute_code` → `execute` and the old write group → `publish` and drops names absorbed into verbs, so the UI shows the
truth the server acts on rather than a stale array.

Availability comes from the server health response via `getToolAvailability()`: `web_search` greys out with an
explanation when no SearXNG backend is configured, and `execute` greys out when the server reports `codeExec: false` —
with targeted help when the cause is fixable locally (a Windows Hypervisor Platform prompt for `whp-disabled`, the
server's own reason otherwise) and a plain "this server does not support code execution" for remote servers. Each row
has a hover-revealed info (ⓘ) button opening `ToolInfoDialog` with the exact model-facing description and input/output
schemas from the shared registry — the row itself carries only the checkbox, title, and any availability badge.

When the Publish grant is enabled, its card expands with a one-row **Author as:** section managing the HM account keys
the agent may sign with: each granted account inline with its profile avatar (`HMIcon`), name, and an ✕ remove button
that appears on hover, followed by small **Grant** and **New Account** buttons. Clicking an account opens
`EditAgentAccountDialog` to rename it or upload a profile photo. Grant is a dropdown of server accounts not yet granted
to this agent; New Account opens the workflow that generates a server-side key, publishes its profile, and creates an
account home document stating that it is an agentic account.

Identity management is owner-only: writers can toggle tools, but the Grant dropdown, the ✕ remove, New Account, and
account renaming are hidden for them, and the server enforces the same rule — `ListSigningIdentities {agentId}` returns
only the granted identities to non-owners (the owner's other keys are private), and a non-owner `UpdateAgent` that
changes `signingKeys` is rejected.

Custom tools — lambda documents from `ListAgentTools` — continue the same list: one row per tool with its name, runtime
badge, and truncated summary, with hover-revealed edit/delete buttons. When there are none, a short "No custom tools
yet" line sits at the bottom of the list next to the **Add tool** button. Writers can add a tool or open the same
`AuthoredToolDialog` to edit every document field: name, summary, description, runtime, source, input schema, and
optional output schema. Renames are atomic and refuse to overwrite another tool. A separate destructive confirmation
permanently deletes a tool. Readers can inspect the same form and content address but do not see create, edit, or delete
controls.

## Session page

The header carries back-navigation to the agent, the shared agent header with Sessions active, an inline editable title
with debounced (600 ms) signed `UpdateSession` saves and an idle/saving/saved/error dot — manual edits win over
agent-generated titles — a system-prompt button opening the exact `systemPromptMarkdown` that would be sent if the
session continued now, and an options menu with **Copy session URL** and **Delete session**. A triggered session also
gets a ⓘ trigger-context popover and a link out to the originating activity.

### The log

`buildAgentSessionChatRows()` turns durable events into rows, then `interleaveRunRecords()` places finished run cards
into the same chronological scroll. Rows are keyed by event id, so a `#event=<id>` hash scrolls to and centers that
message.

Every row knows its **actor**, and the actor is checked before the role — because the runtime writes to the log as
`role: 'user'` (the only turn a model takes instruction from) while nobody typed those words:

- **user** messages render as the familiar blue bubble with the originator's live Seed account icon on the right (legacy
  rows without origin metadata use a neutral user glyph);
- **system** messages render as `SystemMessageRow` — no bubble, no name, quiet grey, set in behind a left rule
  (`assistant-message-rendering.tsx:187`). This is what continuation prompts and unmet-obligation notices look like:
  visibly the machinery talking about the conversation rather than a voice in it;
- **agent** messages render as assistant parts;
- a tool row whose actor is `user` carries a small **"You"** chip in its header (`assistant-message-rendering.tsx:1966`)
  — the wrench palette's results, sitting in the shared log where the agent will read them.

Every row can explain itself. A **message** ⓘ opens the exact markdown the model sees, a share URL of the form
`<server>/agents/<agentId>/sessions/<sessionId>#event=<eventId>`, session/message/seq ids, and any window context that
rode along hidden. A **tool** row's ⓘ opens `ToolCallDebugDialog` with the raw input and output payloads (and the source
of a script child, when there is one). Both end in the same **Details** grid, built by `eventMetaRows()`
(`models/event-meta.ts`): a user message's originator account and exact signer, or an agent event's model, provider,
duration, and turn token breakdown — total, input, output, cache read, cache write. The grid is strictly additive: an
event recorded before the runtime stamped provenance shows no Details section at all rather than labelled blanks.

Tool rows dispatch a purpose-built detail view per tool (`assistant-message-rendering.tsx:2034`): `delegate` shows the
brief and the child's own work, `execute` shows the code with a live output tail, an address-bearing `read` or `write`
shows the resolved target, and a hypermedia write command gets its own phrasing. A `call` row borrows the **called**
tool's icon, label, and links, with input paths rebased under `input.` (`getRowToolMetadata`,
`assistant-message-rendering.tsx:687`) — so it never reads "Call · execute".

Other session-page behavior: optimistic user messages stamped with the selected account immediately, concurrent sends
while the agent is busy (the server persists them immediately and serializes their model turns), live assistant partials
with a streaming cursor, a run status bar (hidden while a pending tool row is already showing its own live status, so
there are never two spinners), auto-scroll with a scroll-to-latest pill, in-app `hm://` link handling, and signed
`StopSession` from the stop button including recovery for sessions stuck in `streaming` with no live runner. Retry is
offered only on the **trailing** error row and only when the agent is not busy (`agent-session-rows.ts:229`), so a
recovered-from error mid-transcript never sprouts a stale button.

A trigger-created session's first message hides the raw `<trigger_context>` / `<trigger_instructions>` text — stripped
from the bubble in `buildAgentSessionChatRows()` (`agent-session-rows.ts:353`) — and renders a per-type
`TriggerContextView` card: icon, headline, source summary, fired time, collapsible activity payload. The exact
model-facing markdown stays available through the raw dialog.

### The composer and the wrench palette

The composer is the full Seed block editor (`CommentEditor`, submit on Enter). Dropped files upload as session-private
attachments through the chunked upload actions with a progress bar, and are referenced by id — they are never written to
memory or IPFS unless the agent does that itself. When the session is driven by its parent the composer is **replaced**
by that explanatory line rather than merely disabled (`session.tsx:773`). Beside the send button sits the **wrench**
(`user-tool-palette.tsx`): the user's side of the symmetric log.

Opening it lists **Read**, **Write**, and every callable the agent is granted and the server can run — filtered through
`normalizeStoredAgentTools` and `getToolAvailability`, with `publish` excluded because it is a grant, not a tool. While
the agent definition is still loading the list says so rather than granting everything. Read takes an address; Write
takes an address, content, and optional options JSON; a callable gets a form generated from its registry input schema
(text, number, boolean, and enum fields), falling back to a raw JSON textarea for deep shapes.

Running one sends `InvokeSessionTool`, and the call and result land on the shared log as actor-`user` events. Two
outcomes are handled specially: an error toasts, and a **contract miss** (the server answered with the tool's contract
instead of a result) keeps the form open with a note pointing at the contract row now in the thread. The wrench is
disabled while the agent is busy — the server rejects user verbs during a live run.

### The pinned run card

`SessionRunCard` (`run-card.tsx`) sits between the message list and the composer, full composer width, never scrolling
away. It is deliberately **transient**: once a run's story stops changing, `RunRecordCard` freezes the same card into
the transcript at that moment, and the pinned slot clears so the next turn is not shadowed by a finished summary. The
session page passes `frozenRunIds` so the two surfaces never tell the same story twice.

`runStoryFrozenAt()` (`models/agent-session-rows.ts:119`) decides when, and only for **orchestrations** — a plain turn's
story is its messages, and always was. Three durable moments qualify: the run reaching a terminal status, a typed
`return_result` delivered within the run's lifetime, or a fully settled plan's server-stamped `settledAt`. Two
deliberate non-freezes: a `waiting` run never freezes, because a parked run may be waiting on _you_ and the place to
answer it is the pinned slot above the composer; and a settled plan the server never stamped stays pinned, since there
is no honest moment to freeze it at. Nothing is anchored to `updatedAt`, which advances with every heartbeat and would
drag a frozen card down the scroll for as long as its run lived.

Both cards share one body, `RunWork` (`run-work.tsx`):

- **Plan steps** with status icons (pending ○ / running ◐ / done ✓ / failed ✕ / skipped –). A step the runtime settled
  from completed sub-agents carries a small uppercase **`auto`** marker with the tooltip "Settled by the runtime from
  completed sub-agent results" (`run-work.tsx:256`) — a checklist that read identically either way would quietly
  attribute the runtime's bookkeeping to the agent's judgment.
- **Children, integrated with their step.** One child attached to a step means the step _is_ that child's row: clicking
  it opens the sub-session, its status dot and live activity ride along, and its cancel button sits at the row's edge
  (revealed on hover, on keyboard focus, and always on touch). A **batch** — two or more children on one step — makes
  the step a plain grouping header, with every child rendered beneath it as a **uniform peer** (`run-work.tsx:436`), so
  no sibling is dressed as the step while the rest hang off it. Children with no home step render the same way.
  Attachment resolves by **step id first**, then a stamped `stepLabel`, then the child's title (`run-work.tsx:384`), so
  a child survives the agent renaming its step between turns.
- **Tool calls**, collapsible, auto-opened only at six or fewer (`OPEN_TOOL_CALLS_LIMIT`, `run-work.tsx:334`). They
  render through the chat's own tool-row component, injected as `renderToolPart` to avoid an import cycle; a script's
  `ctx.call(…, {description})` narration becomes the row's summary.

`displayStepStatus()` (`run-work.tsx:157`) rewrites statuses after the fact rather than leaving a stale checklist: once
the owning run has finished, a still-`running` step reads done and a `pending` one reads skipped; in `idle` mode a
`running` step falls back to pending.

The card header carries the run title, a status pill, a live elapsed timer that freezes when the run does, rolled-up
token usage, and cancel (confirm, then `CancelRun` on the root, cascading to the subtree). Two more collapsed-by-default
drawers sit below the body: **Code** (`RunSourceDrawer`, `run-card.tsx:486`) showing a script run's verbatim
`sourceText`, and **Activity** (`RunActivityDrawer`, `run-card.tsx:406`), a terminal-style tail of the whole tree's
journal — `ctx.log` lines toned by level, step transitions, tool and child call lines, and failed results with their
error — ordered across runs and capped at the last 100 lines, each unfolding its full journal entry on click.

**Parked runs** get a specific banner rather than a bare "Waiting": "Waiting on N sub-sessions — M done" for children, a
timer countdown with a once-per-second clock, elapsed-time track, and wake time, and for an event wait
`ParkedRunActions` (`run-parked-actions.tsx`) renders the run's `answerWith` signal as an **Answer** button (with an
optional "Answer with data" payload editor) or, for a budget pause, **Resume** — the one wait a person has to end, so it
does not hide behind "Waiting". A timer child attached to the running plan step renders that countdown in the step
itself; it is not repeated as a loose workflow row. Timer-script transcript calls read **Waiting/Waited**, never the
internal verb name “Delegate”.

With no live run but an unfinished `SessionInfo.plan` present, the card falls back to the plan verb's todo list alone
(`run-card.tsx:147`). Once the plan settles, its server-stamped owning run keeps the complete snapshot and the same card
freezes into the transcript before the closing assistant answer. The checklist stays open and readable there; code,
activity, child runs, and recovered child failures move under a collapsed **Run details** disclosure so a successful
answer remains the final, dominant state.

Data flow is durable-first: the latest root run from `ListRuns {sessionId}` (`useSessionRuns`), the tree from
`ListRuns {rootRunId}` (`useRunTree`), and the signed `runs/<rootRunId>` subscription (`useAgentRunTreeSubscription`)
animating it. The subscribe replay re-sends every run snapshot plus all journal entries, so a reload reconstructs the
card from nothing else.

### Sub-sessions

Session lists nest children (`components/session-children.tsx`): a parent row with `childSessionCount` shows a lazy "▸ N
sub-sessions" disclosure with a rolled-up status dot; expanding fetches `ListSessions {parentSessionId}`. Both the
sidebar picker and the Sessions tab filter their flat lists to top-level rows, so children never appear twice.

A child session page shows a "⤴ parent" breadcrumb and, while its own run is live (looked up by `SessionInfo.runId` →
`GetRun`, since `ListRuns {sessionId}` deliberately returns only root runs), replaces the composer with "This
sub-session is being driven by its parent — watch, or open the parent to intervene."

## Shared chat rendering

`ChatMessageBubble` and `AssistantMessageParts`, exported from
`frontend/apps/desktop/src/components/assistant-message-rendering.tsx`, are used by both the Agents session page and the
assistant panel. Tool bubble selection is driven by the shared registry (`agents/protocol/src/tool-registry.ts`), the
same source as the model-facing descriptions and schemas — so `read` rows prefer document titles over raw `hm://` URLs,
hypermedia writes keep purpose-built phrasing (a comment, a move, a grant read nothing like "wrote"), and every other
address gets a resolved one-liner. Rows expand to raw input/output for debugging, and a live tool shows its streamed
detail and output tail while it runs.

## Automatic refresh and agent-created content sync

The hooks in `models/agents.ts` periodically refetch health, provider, agent-list, agent-detail, and session queries for
the active servers. Mutations invalidate the relevant `['agents', ...]` query keys, and the WebSocket subscription hook
updates or invalidates caches when any configured server emits live changes. Normal Agents workflows should never need a
manual refresh.

While a remote session is open, its WebSocket append handler also keeps every `hm://` document or comment created or
linked by the agent subscribed through the desktop's normal sync service. Structured write results come from the tool
registry's `getReferencedUrls`; assistant prose is scanned for `hm://` links. Comment links subscribe recursively to the
target document so the comment blobs arrive too. These are live subscriptions, not one-shot discovery requests: they
survive the initial peer-connection race and cached pre-publish discovery results, and are released when the session
closes. “Open” is intentionally UI-scoped: a mounted full session page or the session currently selected in the
Assistant sidebar. Account/agent list subscriptions and other background sessions do not start content sync. The hook
also keeps the local node peered with the agent server's advertised `hmServerUrl`. The result is that a link the agent
just produced opens from the desktop without waiting for a later background sync.

## WebSocket hook

```ts
useAgentWebSocketSubscription(serverUrl, accountUid, key, afterSeq)
```

Builds the URL, signs a `Subscribe` action, sends the CBOR envelope, parses JSON server events from
string/Blob/ArrayBuffer, updates the React Query cache for durable appends, starts local sync subscriptions for HM
references in open sessions, accumulates live partial text per session, keeps the partial visible until the durable
append arrives, and reconnects with backoff. The run-tree and session subscriptions share one signed-socket lifecycle
(`useSignedAgentSocket`).

Diagnostic logs are documented in [Operations](./operations.md) and
[WebSocket subscriptions](./websocket-subscriptions.md).

## Optimistic user messages

`addOptimisticSessionMessage()` inserts a temporary user event while the signed request is in flight; the hook removes
matching optimistic events when the durable one arrives.

## Known UI gaps

- Provider deletion is missing; secret rotation UX is minimal; there is no provider test button.
- Newly added provider types still need real-provider manual smoke coverage, and the UI does not surface which providers
  are verified end-to-end.
- No model presets or capability validation beyond suggested defaults.

## Manual desktop smoke test

1. Start server; start desktop; open Agents and confirm health is online.
2. Save a provider (API key or ChatGPT sign-in) and create an agent using it.
3. Open the agent, check the Tools tab shows four grants and the "No custom tools yet" note.
4. Create a session and send a message; confirm the user message appears immediately and the reply streams as markdown.
5. Ask it to read a Seed URL, including a clean HM web-domain URL; confirm the tool row shows the requested URL and the
   resolved identity.
6. Ask it for a task with three or more steps; confirm the pinned card shows the checklist and clears into the
   transcript when the run ends.
7. Ask it to delegate two independent pieces of research in one turn; confirm both children render as uniform peers
   under one step.
8. Ask it to write itself a tool, then call it; confirm the row appears in Custom tools with its source and CID.
9. Add a tool manually, edit every field including its name, then delete it; confirm each change appears immediately.
10. Run a read from the wrench palette; confirm the row carries the "You" chip and the agent refers to it next turn.
11. Reload the window and confirm the transcript, run records, and card state all reconstruct.
