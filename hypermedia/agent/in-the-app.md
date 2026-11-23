---
name: Agents in the Seed app
summary: A tour of the agent screens in the Seed app and the Seed web app, from the assistant panel to the agent's tabs, the session log and the run card.
---
You use an agent in the [Seed app](../software/desktop.md) or the [Seed web app](../software/web.md). The [Seed Agents](../agent.md) server, the [app environment](../software/app-environment.md), has no screens of its own. Both apps draw the same screens from one shared package. So a tool row, a run card, or a [trigger](../trigger.md) form looks and works the same wherever it appears. This page describes what those screens do. The [signed API](../build/signed-api.md) describes what they send. <!-- id:g4tea9Du -->

# Two places to work <!-- id:T7G6VI9d -->

Two parts of the app show the same sessions.

The **agent pages** fill the window: one page per agent with its tabs, and one page per session or run. There is no page that lists all agents and no page per server. An agent is a [document](../protocol/documents.md). You find it in the file browser of the space that holds it, where it has an agent icon. See [Agents are documents](./mounting.md).

The **assistant panel** is the same thing in a column.

- On the desktop, the Agents button in the space header opens and closes it. It opens in the side panel beside what you are reading. It shares that panel with Bookmarks and Activity, so opening one closes the others.
- On the web, the assistant button in the [site](../protocol/sites.md) header opens it in the side panel that Activity uses, and opening one closes the other. The panel stays open when you move to another page.
- On a narrow screen it fills the screen, with a "Back to page" bar. It does so only when you opened it there. A panel that was left open earlier never takes over a narrow screen by itself. <!-- id:p_UDNR-m -->

The panel opens only when the reader asks for it. It shows the chat list unless a chat was already open. Unread chats are marked in the list and on the button, and the app never opens them by itself. On the web, each browser tab remembers whether the panel is open, which chat is open, and the agent filter. So a reload brings them back, and a new tab starts closed. The app forgets a remembered chat when its agent is not one of the site's own. On the web the full pages live under `/hm/agents/`.

Both need a selected [account](../protocol/identity.md), because an app environment, including the local one, rejects unsigned requests. With no account, the pages ask you to sign in. <!-- id:5ouzsQhP -->

# The assistant panel <!-- id:HML6jSAg -->

The panel's dropdown filters the chat list to one agent or to **All agents**. The agents are grouped by the space they live in, not by server. Each group has the name of that space's [home document](../protocol/spaces.md), and the space on screen is marked **This space**. Orphan agents come last, under **Orphan agents**. Each of those rows names its server, since the server is the only place the agent lives. Below the list is the composer, the box where you type a message. Sending a first message opens the new chat in the panel. The chat header has a back button to the same filtered list, plus Open, Copy URL, and Delete. <!-- id:IEXTQo0x -->

If the account owns [orphan agents](./mounting.md), the agents button has a red dot and a tooltip that counts them. A **Give your orphan agents a home** card stays at the top of the panel's list, or above the empty list. It has one row per agent with an **Adopt** button, which opens the adopt dialog and then the agent's new page. You can fold the card to one line until you restart, and it shows **Show all** when it has more than four rows. It goes away once every owned agent has a space.

The desktop panel also lists the built-in **Assistant**, and the panel sends what is on your screen along with each message. Both are explained in [The Assistant and window context](./assistant.md).

# Servers and providers <!-- id:TjEPYV5a -->

There is no list of servers to manage. You choose a server at the moment you put something on it. The Create Agent and New app dialogs show it (**Runs on**) with a **Change** link, and the Move dialog asks for a destination. Each offers the servers the app already knows (its local one, the ones used before, the ones the space's mount documents name, the built-in default) and **Another server…**, which takes any URL. The app remembers a server when you create something on it or move something to it. It forgets a server when you press **Stop checking this server** in the assistant panel, which is shown beside a server that does not answer. [Which servers a client talks to](./mounting.md) has the rules.

A server's **Model providers** and **Server accounts** dialogs open from the Settings tab of an agent that runs on it. Only the owner sees them.

On desktop, General settings has a **Local app environment** switch that runs or stops the bundled server. It is off by default, so a fresh install never starts the bundled server. The switch is disabled while the app is attached to a development server. See [environments](../operate/environments.md).

## The providers dialog <!-- id:oCo4dRsk -->

The dialog lists the account's [model providers](./model-providers.md) with their logos, never with their keys. It can save a provider of every type (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, custom). There are two ways to sign in to a provider:

- an **API key**, saved with a signed `SetSecret` and then `SetModelProvider`. The dialog refuses to send a key to a remote server over plain HTTP.
- **Sign in with ChatGPT**, offered only when the provider supports it and the server's health reports `subscriptionAuth: true`. The flow needs the desktop app to catch the provider's redirect to localhost.

A provider whose sign-in expired shows a button to sign in again. `ollama` and `custom` get a base URL you can edit and an optional key. Details in [model providers](./model-providers.md) and [Sign in with ChatGPT](./chatgpt-sign-in.md). <!-- id:mFo11uFR -->

## Creating an agent <!-- id:TIo5XyXG -->

**Agent** in a home document's **New** menu opens the Create Agent dialog. It asks for a name, a model from the provider's list, and what the agent may write, and it shows the server. When the server has no provider yet, the dialog asks for one first. [Agents are documents](./mounting.md) describes what creating an agent does.

# The agent page <!-- id:Sx4cd-1l -->

An agent that has a document is shown inside its document. The document's tab bar becomes the agent's: **Home**, **Sessions**, **Triggers**, **Memory**, **People**, **Settings**. The document's own Attributes, Connections and people tabs are not shown, and **Comments** shows only when a [comment](../protocol/comments.md) exists. The options menu has **Attributes** and **Open <name> profile**, which opens the [profile](../profile.md) of the account the agent signs as. It has no **Convert to Collection**. The **Publish** button appears in the header only when the draft has something to publish.

Under the tabs, the agent view is a plain column that takes the rest of the window. The view scrolls inside it, so the composer stays at the bottom with nothing below it.

The tabs: <!-- id:vzOPua2M -->
  - **Home** is the agent's document, opened by default. It is the agent's instructions, edited like any document, and the tools, pages, triggers and apps made under the agent appear in it as cards. The agent reads the latest published version at the start of each turn. A composer at the bottom starts a new session, for anyone who may chat with the agent. See [what an agent is told](./prompt.md).
  - **Sessions** lists [sessions](./session.md) newest first and creates new ones. Child sessions are folded under their parents, with one status dot for the whole group. <!-- id:Wa4YNjU2 -->
  - **Triggers** lists and edits triggers. The [triggers](./triggers.md) page describes the forms and the firing history. <!-- id:L_LGlu75 -->
  - **Memory** browses and edits `~/memory`: entries with sizes, a monospace editor with Save and Revert for text files, inline image, audio, and video previews, download, upload (including drag and drop onto the list or a folder), download from a URL, new file with nested paths, and **Publish to IPFS** with a copyable [`ipfs://`](../protocol/files.md) address. Files over 32 MiB have no preview. The tab updates live from `agent-memory-changed` events, so you see files appear while code writes them. A `~/memory/…` link in a tool row opens the file here. <!-- id:HKDoTQey -->
  - **People** lists who can use the agent and shows what the agent itself can write. See [sharing an agent](./sharing.md) and [what the agent can write](./mounting.md).
  - **Settings** edits the model, the [reasoning level](./reasoning-levels.md) and the [thoroughness](./delegation-budgets.md), shows the server, and has one row for each of the pages below. Each row summarises its page: the enabled grants, the granted identities, the number of servers. The owner also finds **Model providers** and **Server accounts** there.

An agent without a document has a page of its own with the tabs **Sessions**, **Triggers**, **Memory**, **Collaborators** and **Settings**, and an **Adopt agent** banner.

## Settings: Permissions <!-- id:vvqbSEIH -->

Five toggle rows configure the [grant](./grants.md) set. The verbs are not grants: <!-- id:o4ukOH2u -->

<!-- id:-mm2iF4X -->
| toggle <!-- col:K-Az8YnL --> | grant <!-- col:YwWr4xyq --> <!-- id:G5AmnnNm --> |
| --- | --- |
| Search Seed content | `search` <!-- id:Ux1B0Wz1 --> |
| Search the web | `web_search` <!-- id:FxqkDPcL --> |
| Execute code | [`execute`](./code-execution.md) <!-- id:SvNchL3a --> |
| Use the integrated browser | `browser`: read and act on websites open in Seed, each site allowed by the user when asked |
| Publish Seed content | `publish`: signed public documents, comments, and IPFS uploads <!-- id:cWfzCnfP --> |

A toggle saves when you change it. The server's health response says what is available: `web_search` is greyed out when no search backend is set up, and `execute` when the server reports that it cannot run code. When you can fix the cause on your computer, the row says how. Each row's info button opens the exact description and schemas the model sees. The `query` and `attributes` [callables](./callables.md) have no toggle, because they are always on (`attributes` reads a document's [attributes](../metadata.md)). With Publish enabled, the row says which identities the agent authors as and links to the identities page. <!-- id:U5HeS5l- -->

## Settings: Authorship identities <!-- id:XKd1IVKy -->

This page lists the [signing identities](./identity.md) the agent may sign and publish as, one row each with its profile icon and name, plus **Grant** and **New Account**. While publishing is off, a notice links back to Permissions, because the agent does not use its identities until publishing is on. Only the owner can manage identities. Writers see the list and nothing else.

## Settings: MCP servers

This page has one row per server of the account. Each row has a checkbox that enables the server for this agent, a chip with the number of tools or **Unreachable**, an Auth chip, and refresh and remove buttons. Click a row to list its tools, and click a tool to open its [contract](./contract.md). **Add server** takes a URL (the name is suggested from the host), an optional Authorization value stored as an encrypted secret, and the transport and header name under Advanced. **Connect** saves the server and finds its tools in one request. See [MCP servers](./mcp.md).

# The session page <!-- id:LXUJmcIH -->

The header has:

- a way back to the agent;
- a title you can edit in place (a signed `UpdateSession`). A title the agent made never overwrites one you typed;
- a system-prompt button, which shows exactly what the server would send if the session went on at this moment;
- the model and thoroughness badges;
- a menu with Copy session URL and Delete.

A session that a trigger started also gets a popover with the trigger context and a link to the activity that started it. <!-- id:OoXkyOnr -->

## The log <!-- id:2g3GZ6UZ -->

Saved events from the [Log](./log.md) become rows. Finished run cards sit between them, in time order. A `#event=<id>` at the end of the URL scrolls to that message.

Every row knows its **[actor](./actor.md)**, and the app checks the actor before the role:

- User messages are blue bubbles with the sender's account icon.
- System messages are quiet grey rows with a line on the left. So [obligation](./obligations.md) reminders and unmet-obligation notices read as the server's notes about the conversation.
- Agent messages are drawn as assistant text.
- A tool row that a person ran carries a **You** chip.

Every row can explain itself. A message's info dialog shows the exact markdown the model sees, a share URL, ids, and any hidden window context. A tool row's dialog shows the raw input and output. Both end in a Details grid with the sender's account and signer, or the model, provider, duration, and token counts. <!-- id:4I5n9iJd -->

Each tool has its own kind of row:

- [`delegate`](./delegate.md) shows the [brief](./brief.md) and the child's work;
- `execute` shows its one-line description, the code, and the output as it arrives;
- [`read`](./read.md) and [`write`](./write.md) show the target, and a Hypermedia write has its own wording;
- a [`call`](./call.md) row uses the icon and label of the tool it called.

A session that a trigger started hides the raw `<trigger_context>` text and shows a context card in its place.

Other behaviour: your message shows at once, before the server confirms it. You can send while the agent is busy, and the server queues the messages in order. Text streams in as the model writes it. A pill scrolls to the latest row. `hm://` links open inside the app. **Stop** also recovers a session stuck in `streaming`. **Retry** shows only when the last event is an error. <!-- id:vLQIw76h -->

## The composer and running a tool yourself <!-- id:5IQw8NMb -->

The composer is the Seed [block](../protocol/blocks.md) editor. Files you drop on it are uploaded as [files](./session.md) private to the session, and the message refers to them by id. They are never written to memory or IPFS unless the agent does that itself. When a parent is driving a child session, a line that says so takes the place of the composer.

Type `/` in the composer to run a tool yourself. The menu has a **Run a tool** group with Read, Write, and every callable the agent is granted and the server can run. Picking one opens a form above the input, made from the tool's input schema. Running it sends `InvokeSessionTool`. The call and its result land on the log as user events, and the agent reads them on its next turn. When the input does not fit the tool's contract, the form stays open and points at the contract row that was added to the thread. While the agent is busy you can fill in the form, but you cannot run it until the agent finishes. See [running a tool yourself](./wrench-palette.md). <!-- id:NoImy3ET -->

## The run card <!-- id:_KR4h8j_ -->

While a [run](./runs.md) is still changing, a card stays pinned between the log and the composer. It shows:

- the run title, a status pill, and a timer;
- the token usage, with the children's added in;
- a cancel button, which also cancels every run under this one;
- a **context meter** for the session;
- the [plan](./plan.md) steps with their status icons;
- the children, shown with their steps. One child on a step makes the step that child's row. A batch shows every child as an equal row;
- tool calls you can fold;
- two drawers: **Code** for a script's source, and **Activity**, a live view of the [journal](./journal.md) of the whole tree.

The card moves into the transcript and the pinned place clears when the run ends, when it returns a [typed result](./typed-result.md), or when the plan settles.

A waiting run stays pinned, because you answer it there:

- a run waiting for children shows "Waiting on N sub-sessions";
- a timer shows a countdown;
- an event wait shows the run's `answerWith` signal as an **Answer** button, with an optional editor for the data to send.

The app builds everything on the card from `ListRuns` and the signed `runs/<rootRunId>` subscription, so a reload loses nothing. <!-- id:HBZRMtDD -->

A child row, and the link on a `delegate` tool row, opens the child's transcript when the child has a session. A script has no session, so its row opens its **run page**: its status, origin and timing, the work, **Code** and **Activity**. For the same reason, a card for a script has an **Open run page** arrow, and a card for a run with a session does not: the session the card sits in is that run's record. If you open the run page of a run that has a session, the app opens the session instead.

## Continuation <!-- id:FDM7RGpy -->

When an agent calls `continue_session`, the conversation moves to a new session, the successor. The successor opens with a handoff card and a link back to the old session. The old session shows where the conversation went. See [session continuation](./session-continuation.md). <!-- id:CBNIjpG2 -->

# Live data <!-- id:HAiWfn2F -->

Every list updates by itself, through regular checks and [WebSocket](../build/websocket-subscriptions.md) messages. There are no reload buttons. Each open screen sends one signed `Subscribe`. It receives new events, live partial text, session and agent changes, and run trees, and it reconnects after a wait when the connection drops.

While a session on a remote server is open, the app also asks the local node's [sync](../protocol/network.md) service for every [`hm://`](../protocol/urls.md) document or comment the agent creates or links. So a link the agent just made opens without a wait. Sessions that are not open do not start this sync. <!-- id:h_FJB1HU -->

# See also <!-- id:2I3uDyM9 -->

- [Seed Agents](../agent.md) <!-- id:NwPcf8q5 -->
- [Agents are documents](./mounting.md)
- [Sharing an agent](./sharing.md)
- [The Assistant and window context](./assistant.md)
- [Session](./session.md)
- [Signed API](../build/signed-api.md) <!-- id:_gykYEJZ -->
- [Running a tool yourself](./wrench-palette.md) <!-- id:rNagNLC1 -->
- [Tools](./tools.md) <!-- id:u6UqAs9x -->
- [Triggers](./triggers.md) <!-- id:R4lPrqze -->
- [Embedding the agents UI](../build/apps-ui.md)
- [Desktop app](../software/desktop.md) <!-- id:HBFmfkNP -->
