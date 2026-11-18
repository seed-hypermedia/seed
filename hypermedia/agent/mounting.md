---
name: Agents are documents
summary: An agent lives in a space as a document that names the server it runs on, and that document decides the agent's name, its address, who finds it, and what happens when it is deleted.
---
An [agent](../agent.md) is found the way any other content is found: as a [document](../protocol/documents.md) in a [space](../protocol/spaces.md). The document is called the agent's **mount document**. It says which [app environment](../software/app-environment.md) runs the agent. Its name is the agent's name. Its body is the agent's instructions.

For example, a space can hold a document named "Helper" at `/helper`. Open it and you see the agent's instructions. Open its sessions view and you can chat with the agent.

This page explains what makes a document an agent, how an agent gets its document, and what follows from that. Who may use the agent is a separate matter, covered in [sharing an agent](./sharing.md).

# The mount document

A document is an agent when two things are true:

- its [metadata](../metadata.md) has `agentServerUrl`, the HTTP(S) address of the app environment that runs the agent;
- that server has an agent registered under the document's exact versionless `hm://` id.

New agents also get `type: hm://hyper.media/agent`. A document with any other type is never an agent.

The second point matters most. A document that only names a server is not an agent, and naming a server gives nobody access. When a document names a server that has no agent for it, the app shows a notice in place of the agent.

Three things follow from the document:

- **The id.** The document's versionless `hm://` id is the agent's id.
- **The name.** The document's `name` attribute is the agent's name.
- **The instructions.** The document's body is what the agent is told. The [blocks](../protocol/blocks.md) other than [card embeds](../block/embed-view.md) are the instructions. The card embeds list the tools, pages, [triggers](../trigger.md) and apps made under the agent.

The server reads the latest published version at the start of every turn. So any writer of the document can change what the agent is told. [What an agent is told](./prompt.md) has the full list.

A document can name a local server or a hosted one. A server on localhost or a private network can be reached only from devices that can reach it. Mounting does not make a local server public, and a visitor must be able to reach the server to use the agent.

# Creating an agent

You create an agent the way you create a document. Pick **Agent** from the **New** menu of a [home document](../protocol/spaces.md), or from the plus button beside Home in the file browser. This is the only way a person creates one. The built-in [Assistant](./assistant.md) is the exception: the desktop app creates it. Agents are always children of the home document, so no other document offers the entry.

The dialog asks for a name, a model, and what the agent may write. It shows the server the agent will run on (**Runs on**) with a **Change** link. The server is chosen in this order:

1. the server the space on screen already uses;
2. the configured default server;
3. the app's own local server, only when nothing else is available.

The [reasoning level](./reasoning-levels.md) and [thoroughness](./delegation-budgets.md) start at their defaults. You change them later in the agent's Settings.

Creating the agent does these things in order:

1. The server creates a [signing identity](./identity.md) for the agent.
2. The app publishes the document under home, at a path made from the name. A number is added to the path when a document already exists there. The body is an embed of the [Agent Guide](./guide.md).
3. The server creates the agent under that document id, with the default [grants](./grants.md): [`search`](./callables.md), `web_search`, [`execute`](./code-execution.md) and `publish`.
4. The app publishes the write access chosen in the dialog as a [capability](../capability.md).

If the document is published and the server action fails, **Retry** uses the same document, signing identity and request again. The server also creates an enabled `activity` trigger for mentions, replies and [comments](../protocol/comments.md), so mentioning the agent's [account](../protocol/identity.md), replying to it, or commenting on its documents starts a [session](./session.md). See [triggers](./triggers.md).

# The name follows the document

The server copies the document's `name` onto the agent when the agent is created or adopted. Editing the agent's definition cannot change the name. To rename the agent, rename the document: edit the title and publish. The server checks every mounted agent's document when it starts and once a minute after that, and applies a changed name.

# Adopting and orphaning

An agent that lives in no space is an **orphan agent**. Its id is an id of its server, not a document id. Its own page shows an **Adopt agent** banner that stays until the agent is adopted. The [assistant panel](./in-the-app.md) lists the account's orphan agents with an **Adopt** button on each.

To **adopt** an orphan is to give it a document. Its owner picks a space and a URL path. The space can be their own, or any space whose home document their signing identity can write to. The document takes the agent's name. The app says "adopt". The protocol action and the code say "mount" (`MountAgent`). The two words mean the same thing.

Adopting waits until the agent is idle and its memory uploads have finished. The server changes every reference in one transaction. It keeps the memory directory and the session history, and it keeps answering to the old server id as a second name. If the document is published and the server action fails, retrying in the dialog uses the same document again.

To **orphan** an agent is the reverse. In developer mode, the options menu of an adopted agent's document offers **Orphan agent**. The server gives the agent its earlier id back, or a fresh one, and keeps its sessions, memory and triggers (`UnmountAgent`, owner only). The document is deleted and the agent's own page opens, so the agent can be adopted again.

An agent with a document cannot be moved to another document or another server. The **Move** action in Settings is offered only for an agent without a document.

# Deleting

A mounted agent has no delete action of its own. To delete the agent, delete its document from the document's own menu. That deletes the agent on its server, with its sessions, its memory and its triggers. The dialog says so.

# What the agent can write

Two capabilities connect the agent and the space that holds its document.

**The space can write the agent's space.** Creating or mounting an agent gives the account that owns the mount location `WRITER` access to the whole space of the agent's primary [signing identity](./identity.md). The agent's key signs that capability.

**The agent can write some part of the space.** This is the agent's **write scope**. You choose it in the create dialog, and the People tab shows it under **What this agent can write**:

| Scope | Capability | Effect |
| --- | --- | --- |
| **Its own document** (the default) | `WRITER` at the document's path | The agent can edit its document and publish its tools, pages and notes under it. |
| **The whole space** | `WRITER` at the root | The agent can publish and edit anywhere in the space, like any writer. |
| **Nothing here** | none | The agent can publish only into its own account. |

Only the owner of the space can grant the scope. The owner can widen it later. A capability cannot be taken back, so to narrow the scope you must give the agent a new account. The server tells each mounted agent its scope at the start of every turn, so the agent puts its work where its user can see it.

Document permissions and agent access stay separate. Publishing a mount document gives nobody access to the agent's sessions or tools. A `WRITER` of the document is not a collaborator on the agent until the owner adds them. See [sharing an agent](./sharing.md).

# How a client finds a space's agents

A space has no agent settings and no list of agents. Its agents are its mount documents.

1. The client asks for the space's documents that have the agent type (`QueryDocuments` with a `type` comparison). It does this after the page is shown, so no page waits for it. The result is cached like any document listing.
2. For each mount document, the client asks the named server for that agent by id (`GetAgent`). The server answers for the owner, an accepted collaborator, or any signed account when the agent is public.

A server by itself does not lead a reader to agents. `ListAgents` returns only agents the caller owns or accepted an invitation to. So a visitor who asks a space's server for a list gets an empty one.

An agent the reader cannot see is left out of lists. On the agent's own page the reader is told why. The page names the server and the reader's account. It gives the fix: ask the owner to share it from the People tab, or sign in as the owner. It also notes that an orphaned or deleted agent looks the same from outside. An account the owner has invited sees the invitation there, with its role and an **Accept invite** button.

Mounted agents are listed in the path order of their documents. The first one is the default of the assistant panel. So someone who arrives at a space can open the panel and start chatting without any setup. A space offers no agents when it has no mount documents, or when the reader can see none of its mounted agents. An agent's name, icon and status are read from the agent itself.

# Which servers a client talks to

**The [web app](../software/web.md)** talks only to the servers named by the mount documents of the [site](../protocol/sites.md) on screen, and only about those agents.

- Its assistant panel lists the site's mounted agents and nothing else.
- The site header shows the button that opens the panel only to a signed-in reader who can see at least one of the site's mounted agents.
- A reader who is not signed in gets no button, because every request to an app environment is signed.
- The deployment's default server (`SEED_AGENT_SERVER_URL`) is where a new agent is created. It is also the server an [app](../app.md) runs on when the app names none.

One exception: a reader who owns orphan agents. The web client asks the deployment's default server, and the servers the site's mounts name, for the account's own agents. While any orphan remains, the button stays visible with a red dot, so the reader can find the adopt card.

**The [desktop app](../software/desktop.md)** adds the account's own agents. It talks to the app's local server, to the servers it remembers the user putting an agent or app on, and to the servers the mount documents of the space on screen name. Nobody edits that list. A server joins it when the user creates an agent or app on it or moves an agent to it, and leaves it through the assistant panel's **Stop checking this server**. A space never names a local server as its own default, since only the computer running it can reach it. <!-- id:tQSjmGEz -->

The app environment needs no settings per client for any of this. It answers signed requests from any origin. It knows a caller by the signed account, never by where the page came from. [Environments](../operate/environments.md) describes the servers themselves.

# Addresses

A mounted agent's screens are views of its document. Each has an address: a `:` term after the document's path. The base URL opens **Home**, the document itself.

| Address | Opens |
| --- | --- |
| `<document>` | Home: the agent's document, which is its instructions |
| `<document>/:sessions` | the list of sessions |
| `<document>/:session/SESSION_ID` | one session |
| `<document>/:triggers` | the triggers |
| `<document>/:triggers/TRIGGER_ID` | one trigger |
| `<document>/:memory` | the memory browser |
| `<document>/:access` | People |
| `<document>/:settings` | Settings |
| `<document>/:settings/prompt`, `/permissions`, `/identities`, `/mcp` | the pages under Settings |

`/:tools` opens the permissions page. On the root of a space, `/:settings` opens the space's settings, not an agent's. Links that share a session or a message open Seed's web UI, never the app environment.

An agent without a document, and any session or [run](./runs.md), also has a web address under `/hm/agents/`:

- `/hm/agents/agent/<id>?server=&tab=&trigger=&file=`
- `/hm/agents/session/<id>?server=&agent=`
- `/hm/agents/run/<id>?server=&agent=`

A copied web link opens in the desktop app.

# See also

- [Seed Agents](../agent.md)
- [Sharing an agent](./sharing.md)
- [Agent identity](./identity.md)
- [What an agent is told](./prompt.md)
- [Agents in the Seed app](./in-the-app.md)
- [Permissions](../protocol/permissions.md)
- [Environments](../operate/environments.md)
- [Signed API](../build/signed-api.md)
