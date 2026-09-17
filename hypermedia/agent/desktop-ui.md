---
name: Desktop and Web UI
summary: What the Agents screens in the Seed app and the Seed web app do, from the assistant panel to the agent page's tabs, the session log, and the run card, and where their shared code lives.
---
The [Seed app](../apps/desktop.md) and the [Seed web app](../apps/web.md) are the clients of a [Seed Agents](../agent.md) server. The server has no browser UI of its own. Both apps render the same screens from one shared package, `frontend/packages/ui/src/agents/`, so a tool row, a run card, or a trigger form looks and behaves the same wherever it appears. This page describes what those screens do. The [signed API](./signed-api.md) describes what they send. <!-- id:g4tea9Du -->

# Two surfaces, one code <!-- id:T7G6VI9d -->

Two surfaces read the same sessions. The **Agents pages** are full-window: an index of recent sessions across every configured server, one page per server, one page per agent with its tabs, and one page per session. The **assistant panel** is the same thing in a column: on the desktop it is toggled from the footer and sits beside whatever you are reading; on the web it is mounted above the site's page outlet so route changes never remount it, opened from the account menu's "Agents" item, full-screen with a "Back to page" bar on narrow screens. On the web the full pages live under `/hm/agents`. <!-- id:p_UDNR-m -->

Both surfaces need a selected [account](../protocol/identity.md), because an agents server, including the local one, rejects unsigned requests. With no account the pages render an invitation to sign in. <!-- id:5ouzsQhP -->

Which servers a client talks to is the union of the app's local server (desktop only), the server a space advertises with the `agentServerUrl` [metadata](../metadata.md) key while any of its [documents](../protocol/documents.md) is open (labelled "This site", never persisted), and the servers the user configured in settings (seeded on the web from `SEED_AGENT_SERVER_URL`). The [environments](./environments.md) page explains how a space publishes its agents with `spaceAgents` so a visitor's panel can find them. <!-- id:tQSjmGEz -->

# The assistant panel <!-- id:HML6jSAg -->

The panel's dropdown filters the chat list to one agent or to **All agents**. Below the list sits the composer; sending a first message opens the new chat in place. The chat header has a back button to the same filtered list, plus Open, Copy URL, and Delete. The built-in **Assistant** is an ordinary agent auto-provisioned on the local server once a model provider exists, created with a deterministic idempotency key so two windows racing on first launch dedupe server-side and so deleting it is respected. Its only callable [grant](./grants.md) is `search`. It has no signing identity, so it cannot publish. <!-- id:IEXTQo0x -->

The panel contributes **window context**: the current URL, title, view, side panel, open [comment](../protocol/comments.md), focused [block](../protocol/blocks.md) and range, and draft state go along as a `context` content part on the first message only. They never appear in the transcript. The user bubble shows a "Context" chip that opens the exact lines the model was given. The panel does not mount the [wrench palette](./wrench-palette.md). <!-- id:uVUDoO7J -->

# The Agents index and server pages <!-- id:TjEPYV5a -->

The index is a **Recent sessions** list merged newest-first across every configured server, paged with Load more. Each row is a session with an agent chip. A space's published agents contribute the visitor's chats with them. When the selected account has pending agent invitations, an **Invites** section offers Accept and Decline. The page title is a dropdown of all agents. The header holds a servers menu (status, Open Server, **Accounts** and **Providers** dialogs, Manage Agent Servers) and Create Agent. Health reads Checking, Unreachable, or Online. The local server's status dot is suppressed unless it is actually erroring. A server page is the same feed scoped to one server. <!-- id:Z1pHVAp_ -->

Servers are managed under Settings, in the **Agent Servers** section. The dev default local server is `http://localhost:3051`. Release builds embed a server on port 3050. See [environments](./environments.md). <!-- id:P7NqFGcG -->

## The providers dialog <!-- id:oCo4dRsk -->

Lists redacted providers with their logos and saves records for every type in the provider registry (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, custom). Two auth modes: an **API key**, saved through signed `SetSecret` then `SetModelProvider` (the dialog refuses to send a key to a remote plain-HTTP server), or **Sign in with ChatGPT**, offered only when the provider supports it and the server's health reports `subscriptionAuth: true`, because the flow needs the desktop app to catch the provider's localhost redirect. A provider whose sign-in expired shows a re-sign-in button. `ollama` and `custom` get an editable base URL and an optional key. Details in [model providers](./model-providers.md). <!-- id:mFo11uFR -->

## The create-agent dialog <!-- id:TIo5XyXG -->

Choose server and provider, name the agent, pick a model from the provider's model list, pick a reasoning level where the model supports one, pick a thoroughness preset, and write the system prompt in the Seed [block](../protocol/blocks.md) editor. The default prompt embeds the shared skill document published on seed.hyper.media, so whoever can edit that document shapes every new agent's prompt ([prompt injection map](./prompt-injection-map.md)). New agents get the default grants: `search`, `web_search`, `execute`, and `publish`. The dialog first creates a dedicated signing [key](../build/keys.md) for the agent, and the server auto-creates an enabled mention [trigger](./triggers.md) following that identity, so mentioning the agent's account starts a session immediately. <!-- id:jal0tOGQ -->

# The agent page <!-- id:Sx4cd-1l -->

Seven tabs: **Sessions**, **Triggers**, **Memory**, **Tools**, **Prompt**, **Collaborators**, **Settings**. <!-- id:vzOPua2M -->
  - **Sessions** lists sessions newest first, nesting child sessions under their parents behind a lazy disclosure with a rolled-up status dot, and creates new ones. <!-- id:Wa4YNjU2 -->
  - **Triggers** lists and edits triggers. The [triggers](./triggers.md) page describes the forms and the firing history. <!-- id:L_LGlu75 -->
  - **Memory** browses and edits `~/memory`: entries with sizes, a monospace editor with Save and Revert for text files, inline image, audio, and video previews, download, upload (including drag and drop onto the list or a folder), download from a URL, new file with nested paths, and **Publish to IPFS** with a copyable [`ipfs://`](../protocol/files.md) address. Files over 32 MB skip the preview. The tab refreshes live from `agent-memory-changed` events, so a sandbox run writing files updates it as it happens, and a `~/memory/…` link in a tool row deep-links to the file. <!-- id:HKDoTQey -->
  - **Tools** configures grants and tools (below). <!-- id:E-7VRtQy -->
  - **Prompt** edits the system prompt in the block editor, autosaving and converting to markdown before the signed `UpdateAgent`. <!-- id:XEPMTElj -->
  - **Collaborators** mirrors the document collaborators page (see [permissions](../protocol/permissions.md)): an invite row with a reader or writer role, the member list with pending invitations, role changes, and revocation, plus the owner-only **public read** and **public chat** switches that let any signed account view, or view and message, the agent by id. Readers see the agent read-only. Writers can edit and chat but cannot manage access or delete the agent. <!-- id:hsNvZDRq -->
  - **Settings** edits the name, model, reasoning level, and thoroughness, and moves or deletes the agent. <!-- id:busoa0uF -->

## The Tools tab <!-- id:vvqbSEIH -->

Four toggle rows configure the [grant](./grants.md) set. The verbs and authored tools are not grants: <!-- id:o4ukOH2u -->

<!-- id:-mm2iF4X -->
| toggle <!-- col:K-Az8YnL --> | grant <!-- col:YwWr4xyq --> <!-- id:G5AmnnNm --> |
| --- | --- |
| Search Seed content | `search` <!-- id:Ux1B0Wz1 --> |
| Search the web | `web_search` <!-- id:FxqkDPcL --> |
| Execute code | `execute` <!-- id:SvNchL3a --> |
| Publish Seed content | `publish`: signed public documents, comments, and IPFS uploads; private memory is always writable <!-- id:cWfzCnfP --> |

Toggles autosave. Stored definitions are normalized on read (`execute_code` becomes `execute`, the old write-group names become `publish`, names absorbed into verbs are dropped), so the tab shows what the server acts on. Availability comes from the server's health response: `web_search` greys out when no search backend is configured, `execute` when the server reports `codeExec: false`, with targeted help when the cause is fixable locally. Each row's info button opens the exact model-facing description and schemas from the shared registry. The `query` and `attributes` callables have no toggle. See the [roadmap](./roadmap.md). <!-- id:U5HeS5l- -->

With Publish enabled the row expands with **Author as**: the signing identities the agent may sign with, each with its profile icon and name, plus **Grant** (an existing server identity) and **New Account** (generates a key, publishes its [profile](../profile.md), and creates a [home document](../protocol/documents.md) saying it is an agentic account). Identity management is owner-only, enforced by the server as well as hidden in the UI. <!-- id:XKd1IVKy -->

**Custom tools** continue the list: one row per authored lambda [tool document](./tool-document.md) with its runtime badge and summary, an editor for every document field (name, summary, description, runtime, source, input and output schemas), atomic renames, and a destructive delete. **MCP servers** close the tab: one row per account server with a checkbox that enables it for this agent, a tool-count or Unreachable chip, an Auth chip, and refresh and remove buttons. Clicking a row lists its tools and clicking a tool opens its contract. **Add server** takes a URL (the name suggests itself from the host), an optional Authorization value stored as an encrypted secret, and transport and header name under Advanced; Connect saves and discovers in one request. See [MCP servers](./mcp.md). <!-- id:Zwty1aaq -->

# The session page <!-- id:LXUJmcIH -->

The header carries back-navigation to the agent, an inline editable title (debounced signed `UpdateSession`; an agent-generated title never overwrites one you typed), a system-prompt button showing exactly what would be sent if the session continued now, the model and thoroughness badges, and a menu with Copy session URL and Delete. A triggered session gets a trigger-context popover and a link to the originating activity. <!-- id:OoXkyOnr -->

## The log <!-- id:2g3GZ6UZ -->

Durable events from the [Log](./log.md) become rows, and finished run cards are interleaved into the same chronological scroll. A `#event=<id>` hash scrolls to that message. Every row knows its **[actor](./actor.md)**, and the actor is checked before the role. User messages are blue bubbles with the sender's live account icon. System messages are quiet grey rows behind a left rule, so continuation prompts and unmet-obligation notices read as runtime notes about the conversation. Agent messages render as assistant parts. A tool row run by a person carries a **You** chip. Every row can explain itself. A message's info dialog shows the exact markdown the model sees, a share URL, ids, and any hidden window context. A tool row's dialog shows raw input and output. Both end in a Details grid with the sender's account and signer, or the model, provider, duration, and token breakdown. <!-- id:4I5n9iJd -->

Tool rows get a purpose-built view per tool: [`delegate`](./delegate.md) shows the [brief](./brief.md) and the child's work, `execute` shows its one-line description, the code, and a live output tail, `read` and `write` show the resolved target, a Hypermedia write gets its own phrasing, and a `call` row borrows the called tool's icon and label. A trigger-created session hides the raw `<trigger_context>` text and renders a context card instead. Other behaviours: optimistic user messages, concurrent sends while the agent is busy (queued and serialized server-side), live streaming partials, a scroll-to-latest pill, in-app `hm://` links, Stop with recovery for sessions stuck in `streaming`, and Retry only on a trailing error. <!-- id:vLQIw76h -->

## The composer and the wrench palette <!-- id:5IQw8NMb -->

The composer is the Seed block editor. Dropped files upload as session-private [attachments](./attachment.md) and are referenced by id. They are never written to memory or IPFS unless the agent does that itself. When a child session is being driven by its parent, the composer is replaced by a line saying so. Beside the send button is the **[wrench](./wrench-palette.md)**, the person's side of the symmetric log: it lists Read, Write, and every callable the agent is granted and the server can run, with a form generated from each tool's input schema. Running one sends `InvokeSessionTool`, and the call and result land on the log as user events the agent reads next turn. A contract miss keeps the form open and points at the contract row now in the thread. The wrench is disabled while the agent is busy. <!-- id:NoImy3ET -->

## The run card <!-- id:_KR4h8j_ -->

A pinned card sits between the log and the composer while a [run](./runs.md) is still changing: the run title, a status pill, an elapsed timer, rolled-up token usage, cancel (cascading to the subtree), a **context meter** for the session, the [plan](./plan.md) steps with their status icons, children integrated with their steps (one child on a step makes the step that child's row; a batch renders every child as a uniform peer), collapsible tool calls, and two drawers: **Code** for a script's source and **Activity**, a terminal-style tail of the whole tree's [journal](./journal.md). Once the run reaches a terminal status, a [typed result](./typed-result.md) is delivered, or the plan settles, the same card freezes into the transcript and the pinned slot clears. A waiting run never freezes, because the place to answer it is above the composer: children show "Waiting on N sub-sessions", a timer shows a countdown, an event wait renders the run's `answerWith` signal as an **Answer** button (with an optional payload editor), and a budget pause renders **Resume**. Everything on the card reconstructs from `ListRuns` and the signed `runs/<rootRunId>` subscription, so a reload loses nothing. <!-- id:HBZRMtDD -->

## Continuation <!-- id:FDM7RGpy -->

When an agent calls `continue_session`, the successor opens with a handoff card and a link back to the predecessor. The predecessor shows where the conversation went. The [session continuation](./session-continuation.md) page has the model. <!-- id:CBNIjpG2 -->

# Live data <!-- id:HAiWfn2F -->

Every list refreshes through React Query polling and [WebSocket](./websocket-subscriptions.md) invalidations. There are no reload buttons. A signed `Subscribe` per open surface streams durable appends, live partials, session and agent changes, and run trees, reconnecting with backoff. While a remote session is open, every [`hm://`](../protocol/urls.md) document or comment the agent creates or links is also subscribed on the local node's [sync](../protocol/network.md) service. A link the agent just produced then opens without waiting for a background sync. Background sessions do not start content sync. <!-- id:h_FJB1HU -->

# Where the code is <!-- id:x3EXavWL -->

- `frontend/packages/ui/src/agents/`: everything above. `list.tsx`, `server.tsx`, `detail.tsx`, `session.tsx`, `header.tsx` are the pages; `assistant-panel.tsx` with `assistant-selection.ts`, `assistant-session-ref.ts`, and `assistant-window-context.ts` is the panel; `dialogs.tsx`, `mcp-servers.tsx`, `memory.tsx`, `trigger-types.tsx`, `user-tool-palette.tsx`, `run-card.tsx`, `run-work.tsx`, `run-parked-actions.tsx`, `continuation.tsx`, `session-children.tsx`, `sessions-feed.tsx`, `new-session-composer.tsx`, `prompt-editor.tsx`, and `message-rendering.tsx` are the pieces named on this page; `models.ts` holds every React Query hook and the signed subscriptions; `client.ts` signs and sends actions and builds server, WebSocket, and webhook URLs; `agent-tools.ts` holds the grant names and defaults; `agent-session-rows.ts` turns events into rows; `space-agents.ts` reads and writes the `spaceAgents` metadata; `platform.ts` is the seam each app implements (signing, navigation, storage). <!-- id:yPdOBjWR -->
- `frontend/apps/desktop/src/pages/agents.tsx` re-exports the shared list page; the desktop's platform implementation, `frontend/apps/desktop/src/agents-platform.ts`, signs through the daemon. <!-- id:VxFQrOGl -->
- `frontend/apps/web/app/routes/hm.agents.tsx` and `hm.agents.$.tsx` mount the pages; `web-assistant-host.tsx` mounts the panel; `web-agents-platform.ts` signs with the browser's device key and the [capability](../protocol/permissions.md) the [vault](../apps/vault.md) issued at [sign-in](../build/sign-in.md). <!-- id:20Vt6Tin -->
- `frontend/packages/shared/src/routes.ts` defines the `agents`, `agent-server`, `agent` (with `tab`, `triggerId`, `memoryPath`), and `agent-session` routes. <!-- id:f8zqWJaA -->
- `agents/protocol/src/tool-registry.ts` is the shared registry that drives tool-row rendering and the wrench palette's forms, the same source as the model-facing descriptions. <!-- id:paiA_noM -->

# Manual smoke test <!-- id:63xnyWtl -->

1. Start a server and the app; open Agents and confirm the server is online. <!-- id:2-mCTqPr -->
2. Save a provider and create an agent; confirm the Tools tab shows four grants and "No custom tools yet". <!-- id:J8GLJkaS -->
3. Send a message; confirm it appears immediately and the reply streams as markdown. <!-- id:lasrcBtg -->
4. Ask the agent to read a Seed URL, including a custom-domain web URL; confirm the row shows the resolved target. <!-- id:yDijYCVS -->
5. Ask for a task with three or more steps and two delegations; confirm the pinned card shows the checklist with both children as peers and freezes into the transcript when the run ends. <!-- id:6gqbLXr0 -->
6. Ask the agent to write itself a tool and call it; confirm the row appears under Custom tools. <!-- id:K_lfckOv -->
7. Run a read from the wrench; confirm the You chip and that the agent refers to it next turn. <!-- id:gg9uksVt -->
8. Reload; confirm the transcript, run cards, and card state reconstruct. <!-- id:fe2AgLbi -->

# See also <!-- id:2I3uDyM9 -->

- [Seed Agents](../agent.md) <!-- id:NwPcf8q5 -->
- [Signed API](./signed-api.md) <!-- id:_gykYEJZ -->
- [Environments](./environments.md) <!-- id:r1KKNsrN -->
- [Wrench palette](./wrench-palette.md) <!-- id:rNagNLC1 -->
- [Tools](./tools.md) <!-- id:u6UqAs9x -->
- [Triggers](./triggers.md) <!-- id:R4lPrqze -->
- [Desktop app](../apps/desktop.md) <!-- id:HBFmfkNP -->
