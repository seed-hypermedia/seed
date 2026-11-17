---
name: Agents in the Seed app
summary: A tour of the agent screens in the Seed app and the Seed web app, from the assistant panel to the agent's tabs, the session log and the run card.
---
The [Seed app](../software/desktop.md) and the [Seed web app](../software/web.md) are the clients of a [Seed Agents](../agent.md) server. The server has no browser UI of its own. Both apps render the same screens from one shared package, so a tool row, a run card, or a trigger form looks and behaves the same wherever it appears. This page describes what those screens do. The [signed API](../build/signed-api.md) describes what they send. <!-- id:g4tea9Du -->

# Two surfaces <!-- id:T7G6VI9d -->

Two surfaces read the same sessions.

The **agent pages** are full-window: one page per agent with its tabs, and one page per session or run. There is no agents index and no page per server. An agent is a document, found in the file browser of the space that holds it, where it carries an agent icon. See [Agents are documents](./mounting.md).

The **assistant panel** is the same thing in a column. On the desktop it is toggled from the Agents button in the space header and opens in the side panel beside whatever you are reading. It shares that panel with Bookmarks and Activity, so opening one closes the others. On the web it is opened from the site header's assistant toggle into the side panel Activity uses, and opening one closes the other. It is mounted above the site's page outlet, so changing the route never remounts it. On a narrow screen it goes full-screen with a "Back to page" bar, but only when it was opened there on purpose: a remembered open state never takes over a narrow screen by itself. <!-- id:p_UDNR-m -->

The panel opens only when the reader asks for it. It shows the chat list unless a chat was already open. Unread chats are flagged in the list and on the toggle, and never opened on the reader's behalf. On the web the open state, the open chat and the agent filter are remembered per browser tab, so a reload restores them while a new tab starts closed. A remembered chat whose agent is not one of the site's own is dropped. On the web the full pages live under `/hm/agents/`.

Both surfaces need a selected [account](../protocol/identity.md), because an app environment, including the local one, rejects unsigned requests. With no account the pages render an invitation to sign in. <!-- id:5ouzsQhP -->

# The assistant panel <!-- id:HML6jSAg -->

The panel's dropdown filters the chat list to one agent or to **All agents**. Its agents are grouped by the space they live in, named by that space's home document, and the space on screen is tagged **This space**. They are not grouped by server. Orphan agents close the list under **Orphan agents**, each row naming its server, since that is the only place it lives. Below the list sits the composer. Sending a first message opens the new chat in place. The chat header has a back button to the same filtered list, plus Open, Copy URL, and Delete. <!-- id:IEXTQo0x -->

If the account owns [orphan agents](./mounting.md), the agents toggle carries a red dot and a tooltip that counts them. A sticky **Give your orphan agents a home** card sits at the top of the panel's list, or above its empty state. It has one row per agent with an **Adopt** button, which opens the adopt dialog and then the agent's new page. The card can be folded to one line for the session and shows **Show all** past four rows. It goes away once every owned agent has a space.

The desktop panel also lists the built-in **Assistant**, and the panel sends the current window along with a first message. Both are explained in [The Assistant and window context](./assistant.md).

# Servers and providers <!-- id:TjEPYV5a -->

There is no list of servers to manage. The server is chosen where something is put on it: the Create Agent and New app dialogs state it (**Runs on**) with a **Change** link, and the Move dialog asks for a destination. Each offers the servers the app already knows (its local one, the ones used before, the ones the space's mount documents name, the built-in default) and **Another server…**, which takes any URL. Creating or moving something onto a server is what makes the app remember it. The assistant panel's **Stop checking this server**, shown beside a server that does not answer, is what makes it forget one. [Which servers a client talks to](./mounting.md) has the rules.

A server's **Model providers** and **Server accounts** dialogs open from the Settings tab of an agent that runs on it, for the owner only.

On desktop, General settings has a **Local app environment** switch that runs or stops the bundled server. It is off by default, a fresh install never starts the bundled server, and the switch is disabled while the app is attached to a development server. See [environments](../operate/environments.md).

## The providers dialog <!-- id:oCo4dRsk -->

Lists redacted providers with their logos and saves records for every type in the provider registry (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, custom). Two auth modes: an **API key**, saved through signed `SetSecret` then `SetModelProvider` (the dialog refuses to send a key to a remote plain-HTTP server), or **Sign in with ChatGPT**, offered only when the provider supports it and the server's health reports `subscriptionAuth: true`, because the flow needs the desktop app to catch the provider's localhost redirect. A provider whose sign-in expired shows a re-sign-in button. `ollama` and `custom` get an editable base URL and an optional key. Details in [model providers](./model-providers.md) and [Sign in with ChatGPT](./chatgpt-sign-in.md). <!-- id:mFo11uFR -->

## Creating an agent <!-- id:TIo5XyXG -->

**Agent** in a home document's **New** menu opens the Create Agent dialog. It asks for a name, a model from the provider's list, and what the agent may write, and it states the server. When the server has no provider yet, the dialog asks for one first. [Agents are documents](./mounting.md) describes what creating an agent does.

# The agent page <!-- id:Sx4cd-1l -->

A mounted agent is shown inside its document. The document's tab bar becomes the agent's: **Home**, **Sessions**, **Triggers**, **Memory**, **People**, **Settings**. The document's own Attributes, Connections and people tabs are not shown, and **Comments** shows only once a comment exists. The options menu has **Attributes**, opens the profile of the account the agent signs as (**Open <name> profile**), and has neither **Document Settings** nor **Convert to Collection**. The **Publish** button stays out of the header until the draft has something to publish.

Under the tabs the agent view is a plain column that takes the rest of the window. The page stops scrolling and the view scrolls inside, so a composer stays pinned at the bottom with nothing below it.

The tabs: <!-- id:vzOPua2M -->
  - **Home** is the agent's document, opened by default. It is the agent's instructions, edited like any document, and the tools, pages, triggers and apps made under the agent appear in it as cards. The agent reads the latest published version at the start of each turn. A composer at the bottom starts a new session, for anyone who may chat with the agent. See [what an agent is told](./prompt.md).
  - **Sessions** lists sessions newest first, nesting child sessions under their parents behind a lazy disclosure with a rolled-up status dot, and creates new ones. <!-- id:Wa4YNjU2 -->
  - **Triggers** lists and edits triggers. The [triggers](./triggers.md) page describes the forms and the firing history. <!-- id:L_LGlu75 -->
  - **Memory** browses and edits `~/memory`: entries with sizes, a monospace editor with Save and Revert for text files, inline image, audio, and video previews, download, upload (including drag and drop onto the list or a folder), download from a URL, new file with nested paths, and **Publish to IPFS** with a copyable [`ipfs://`](../protocol/files.md) address. Files over 32 MB skip the preview. The tab refreshes live from `agent-memory-changed` events, so a sandbox run writing files updates it as it happens, and a `~/memory/…` link in a tool row deep-links to the file. <!-- id:HKDoTQey -->
  - **People** lists who can use the agent and shows what the agent itself can write. See [sharing an agent](./sharing.md) and [what the agent can write](./mounting.md).
  - **Settings** edits the model, the reasoning level and the thoroughness, shows the server, and has one row for each of the pages below. Each row summarises its page: the enabled grants, the granted identities, the number of servers. The owner also finds **Model providers** and **Server accounts** there.

An agent without a document has a page of its own with the tabs **Sessions**, **Triggers**, **Memory**, **Collaborators** and **Settings**, and an **Adopt agent** banner.

## Settings: Permissions <!-- id:vvqbSEIH -->

Five toggle rows configure the [grant](./grants.md) set. The verbs are not grants: <!-- id:o4ukOH2u -->

<!-- id:-mm2iF4X -->
| toggle <!-- col:K-Az8YnL --> | grant <!-- col:YwWr4xyq --> <!-- id:G5AmnnNm --> |
| --- | --- |
| Search Seed content | `search` <!-- id:Ux1B0Wz1 --> |
| Search the web | `web_search` <!-- id:FxqkDPcL --> |
| Execute code | `execute` <!-- id:SvNchL3a --> |
| Use the integrated browser | `browser`: read and act on websites open in Seed, each site allowed by the user when asked |
| Publish Seed content | `publish`: signed public documents, comments, and IPFS uploads; private memory is always writable <!-- id:cWfzCnfP --> |

Toggles save as they change. Availability comes from the server's health response: `web_search` greys out when no search backend is configured, and `execute` when the server reports that it cannot run code, with targeted help when the cause can be fixed locally. Each row's info button opens the exact model-facing description and schemas. The `query` and `attributes` callables have no toggle, because they are always on. With Publish enabled, the row says which identities the agent authors as and links to the identities page. <!-- id:U5HeS5l- -->

## Settings: Authorship identities <!-- id:XKd1IVKy -->

The [signing identities](./identity.md) the agent may sign and publish as, one row each with its profile icon and name, plus **Grant** and **New Account**. A notice links back to Permissions while publishing is off, since the identities are not used until then. Only the owner can manage identities. Writers see the list and nothing else.

## Settings: MCP servers

One row per account server with a checkbox that enables it for this agent, a tool-count or Unreachable chip, an Auth chip, and refresh and remove buttons. Clicking a row lists its tools and clicking a tool opens its contract. **Add server** takes a URL (the name suggests itself from the host), an optional Authorization value stored as an encrypted secret, and transport and header name under Advanced; Connect saves and discovers in one request. See [MCP servers](./mcp.md).

# The session page <!-- id:LXUJmcIH -->

The header carries back-navigation to the agent, an inline editable title (debounced signed `UpdateSession`; an agent-generated title never overwrites one you typed), a system-prompt button showing exactly what would be sent if the session continued now, the model and thoroughness badges, and a menu with Copy session URL and Delete. A triggered session gets a trigger-context popover and a link to the originating activity. <!-- id:OoXkyOnr -->

## The log <!-- id:2g3GZ6UZ -->

Durable events from the [Log](./log.md) become rows, and finished run cards are interleaved into the same chronological scroll. A `#event=<id>` hash scrolls to that message. Every row knows its **[actor](./actor.md)**, and the actor is checked before the role. User messages are blue bubbles with the sender's live account icon. System messages are quiet grey rows behind a left rule, so continuation prompts and unmet-obligation notices read as runtime notes about the conversation. Agent messages render as assistant parts. A tool row run by a person carries a **You** chip. Every row can explain itself. A message's info dialog shows the exact markdown the model sees, a share URL, ids, and any hidden window context. A tool row's dialog shows raw input and output. Both end in a Details grid with the sender's account and signer, or the model, provider, duration, and token breakdown. <!-- id:4I5n9iJd -->

Tool rows get a purpose-built view per tool: [`delegate`](./delegate.md) shows the [brief](./brief.md) and the child's work, `execute` shows its one-line description, the code, and a live output tail, `read` and `write` show the resolved target, a Hypermedia write gets its own phrasing, and a `call` row borrows the called tool's icon and label. A trigger-created session hides the raw `<trigger_context>` text and renders a context card instead. Other behaviours: optimistic user messages, concurrent sends while the agent is busy (queued and serialized server-side), live streaming partials, a scroll-to-latest pill, in-app `hm://` links, Stop with recovery for sessions stuck in `streaming`, and Retry only on a trailing error. <!-- id:vLQIw76h -->

## The composer and the wrench palette <!-- id:5IQw8NMb -->

The composer is the Seed block editor. Dropped files upload as session-private [files](./session.md) and are referenced by id. They are never written to memory or IPFS unless the agent does that itself. When a child session is being driven by its parent, the composer is replaced by a line saying so. Beside the send button is the **[wrench](./wrench-palette.md)**, the person's side of the symmetric log: it lists Read, Write, and every callable the agent is granted and the server can run, with a form generated from each tool's input schema. Running one sends `InvokeSessionTool`, and the call and result land on the log as user events the agent reads next turn. A contract miss keeps the form open and points at the contract row now in the thread. The wrench is disabled while the agent is busy. <!-- id:NoImy3ET -->

## The run card <!-- id:_KR4h8j_ -->

A pinned card sits between the log and the composer while a [run](./runs.md) is still changing: the run title, a status pill, an elapsed timer, rolled-up token usage, cancel (cascading to the subtree), a **context meter** for the session, the [plan](./plan.md) steps with their status icons, children integrated with their steps (one child on a step makes the step that child's row; a batch renders every child as a uniform peer), collapsible tool calls, and two drawers: **Code** for a script's source and **Activity**, a terminal-style tail of the whole tree's [journal](./journal.md). Once the run reaches a terminal status, a [typed result](./typed-result.md) is delivered, or the plan settles, the same card freezes into the transcript and the pinned slot clears. A waiting run never freezes, because the place to answer it is above the composer: children show "Waiting on N sub-sessions", a timer shows a countdown, an event wait renders the run's `answerWith` signal as an **Answer** button (with an optional payload editor), and a budget pause renders **Resume**. Everything on the card reconstructs from `ListRuns` and the signed `runs/<rootRunId>` subscription, so a reload loses nothing. <!-- id:HBZRMtDD -->

## Continuation <!-- id:FDM7RGpy -->

When an agent calls `continue_session`, the successor opens with a handoff card and a link back to the predecessor. The predecessor shows where the conversation went. The [session continuation](./session-continuation.md) page has the model. <!-- id:CBNIjpG2 -->

# Live data <!-- id:HAiWfn2F -->

Every list refreshes through React Query polling and [WebSocket](../build/websocket-subscriptions.md) invalidations. There are no reload buttons. A signed `Subscribe` per open surface streams durable appends, live partials, session and agent changes, and run trees, reconnecting with backoff. While a remote session is open, every [`hm://`](../protocol/urls.md) document or comment the agent creates or links is also subscribed on the local node's [sync](../protocol/network.md) service. A link the agent just produced then opens without waiting for a background sync. Background sessions do not start content sync. <!-- id:h_FJB1HU -->

# See also <!-- id:2I3uDyM9 -->

- [Seed Agents](../agent.md) <!-- id:NwPcf8q5 -->
- [Agents are documents](./mounting.md)
- [Sharing an agent](./sharing.md)
- [The Assistant and window context](./assistant.md)
- [Session](./session.md)
- [Signed API](../build/signed-api.md) <!-- id:_gykYEJZ -->
- [Wrench palette](./wrench-palette.md) <!-- id:rNagNLC1 -->
- [Tools](./tools.md) <!-- id:u6UqAs9x -->
- [Triggers](./triggers.md) <!-- id:R4lPrqze -->
- [Embedding the agents UI](../build/apps-ui.md)
- [Desktop app](../software/desktop.md) <!-- id:HBFmfkNP -->
