---
name: Agents are documents
summary: An agent lives in a space as a document that names the server it runs on, and that document decides the agent's name, its address, who finds it, and what happens when it is deleted.
---
An [agent](../agent.md) is found the way any other content is found: as a [document](../protocol/documents.md) in a [space](../protocol/sites.md). The document is called the agent's **mount document**. It says which app environment runs the agent, it carries the agent's name, and its body is the agent's instructions. This page explains what makes a document an agent, how an agent gets its document, and what follows from that. Who may use the agent is a separate matter, covered in [sharing an agent](./sharing.md).

# The mount document

A document is an agent when three things hold:

- its [metadata](../metadata.md) has `type: hm://hyper.media/agent`;
- its metadata has `agentServerUrl`, the HTTP(S) address of the app environment that runs the agent;
- that server has an agent registered under the document's exact versionless `hm://` id.

The third point matters most. Advertising a server does not make a document an agent, and the annotation alone gives nobody access. A document that carries `agentServerUrl` and no `type` is also shown as an agent when the server registers it under its id. A document that names a server which has no agent for it shows a notice in place of the agent.

The document's versionless `hm://` id is the agent's id. Its `name` attribute is the agent's name. Its body is the agent's instructions: the blocks other than card embeds are what the agent is told, and the card embeds list the tools, pages, triggers and apps made under it. The server reads the latest published version at the start of every turn, so any writer of the document can change what the agent is told. [What an agent is told](./prompt.md) has the full assembly.

Local and hosted servers can both be named. A server on localhost or a private network stays reachable only from devices that can reach it: mounting does not make a local server public, and a visitor must be able to reach the server to use the agent.

# Creating an agent

A new agent is created the way a new document is: pick **Agent** from the **New** menu of a home document, or from the plus button beside Home in the file browser. This is the only way to create one. Agents are always children of the home document, so the entry is absent under every other document.

The dialog asks for a name, a model, and what the agent may write. It states the server the agent will run on (**Runs on**) with a **Change** link. The agent runs on the server the space on screen already uses, else on the configured default server, and on the app's own local server only when nothing else is on offer. Reasoning level and thoroughness start at their defaults and are changed later in the agent's Settings.

Creating the agent does these things in order:

1. A [signing identity](./identity.md) is created for the agent on the server.
2. The document is published under home, at a path derived from the name. A numeric suffix avoids an existing document. Its body is an embed of the [Agent Guide](./guide.md).
3. The server creates the agent directly under that document id, with the default [grants](./grants.md): `search`, `web_search`, `execute` and `publish`.
4. The write access chosen in the dialog is published as a [capability](../protocol/permissions.md).

If the document publishes but the server action fails, **Retry** reuses the same document, signing identity and request. The server also creates an enabled mention [trigger](./triggers.md) for the new identity, so mentioning the agent's account starts a session.

# The name follows the document

The server copies the document's `name` onto the agent when the agent is created or adopted. An edit of the agent's definition cannot change it. To rename the agent, rename the document: edit the title and publish. The server checks every mounted agent's document when it starts and once a minute after that, and applies a changed name.

# Adopting and orphaning

An agent that lives in no space is an **orphan agent**. Its id is an id of its server, not a document id. Its own page shows a persistent **Adopt agent** banner, and the [assistant panel](./in-the-app.md) lists the account's orphan agents with an **Adopt** button on each.

To **adopt** an orphan, its owner picks a space (their own, or any whose home their signing identity can write to) and a URL path. The path is never deeper inside the space. The document takes the agent's name. The user-facing verb is adopt; the protocol action and the code call it mount (`MountAgent`).

Adopting waits for an idle agent and for memory uploads to finish. The server changes every reference in one transaction, keeps the memory directory and the session history, and keeps answering to the old server id as an alias. If the document publishes but the server action fails, retrying in the dialog reuses the document.

**Orphan agent** is the undo, offered in developer mode in the options menu of an adopted agent's document. The server gives the agent its earlier id back, or a fresh one, and keeps its sessions, memory and triggers (`UnmountAgent`, owner only). The document is deleted and the agent's own page opens, so it can be adopted again.

An agent with a document cannot be moved to another document or another server. The **Move** action in Settings is offered only for an agent without a document.

# Deleting

A mounted agent has no delete of its own. Deleting the document, from the document's own menu, deletes the agent on its server: its sessions, its memory and its triggers go with it, and the dialog says so.

# What the agent can write

Two capabilities connect the agent and the space that holds its document.

**The space can write the agent's space.** Creating or mounting an agent gives the account that owns the mount location recursive `WRITER` access across the space of the agent's primary [signing identity](./identity.md). The agent's key signs that capability.

**The agent can write some part of the space.** This is the agent's **write scope**, chosen in the create dialog and shown on the People tab under **What this agent can write**:

| Scope | Capability | Effect |
| --- | --- | --- |
| **Its own document** (the default) | `WRITER` at the document's path | The agent can edit its document and publish its tools, pages and notes under it. |
| **The whole space** | `WRITER` at the root | The agent can publish and edit anywhere in the space, like any writer. |
| **Nothing here** | none | The agent can publish only into its own account. |

Only the owner of the space can grant the scope. The owner can widen it later. Capabilities cannot be revoked, so narrowing it means giving the agent a new account. The server tells each mounted agent its scope at the start of every turn, so the agent puts its work where its user can see it.

Document permissions and agent access stay separate. Publishing a mount document gives nobody access to the agent's sessions or tools, and a `WRITER` of the document is not a collaborator on the agent until the owner adds them. See [sharing an agent](./sharing.md).

# How a client finds a space's agents

A space has no agent settings and no registry of agents. Its agents are its mount documents. To find them, a client queries the space's documents for the agent type (`QueryDocuments` with a `type` comparison). The query runs on the client after the page is up, so no page waits on it, and the result is cached like any document listing.

For each mount document the client then asks the named server for that agent by id (`GetAgent`). The server answers for the owner, an accepted collaborator, or any signed account once the agent is public. A server alone does not reach a reader: `ListAgents` returns only agents the caller owns or accepted an invitation to, so a visitor who asks a space's server for a list gets an empty one.

An agent the reader cannot see is left out of lists. On the agent's own page the reader is told why: the server and the reader's account are named, with the fix (ask the owner to share it from the People tab, or sign in as the owner), and a note that an orphaned or deleted agent looks the same from outside. An account the owner has invited sees the invitation there instead, with its role and an **Accept invite** button.

Mounted agents are listed in their documents' path order. The first one is the assistant panel's default, so someone who arrives at a space can open the panel and start chatting without configuring anything. A space whose mounted agents the reader cannot see offers no agents at all, and so does a space with no mounts. An agent's name, icon and status are read from the agent itself.

# Which servers a client talks to

**The web app** talks only to the servers named by the mount documents of the site on screen, and only about those agents. Its assistant panel lists the site's mounted agents and nothing else. The site header shows the panel's entry point only to a signed-in reader who can see at least one of the site's mounted agents. A reader who is not signed in gets no entry point, because every request to an app environment is signed. The deployment's default server (`SEED_AGENT_SERVER_URL`) is used for one thing: it is the server a new agent is created on.

One exception: a reader who owns orphan agents. The web client asks the deployment's default server and the servers the site's mounts name for the account's own agents, and while any orphan remains the entry point stays visible with a red dot, so the adopt card can be found.

**The desktop app** adds the account's own agents. It talks to the app's local server, to the servers it remembers the user putting an agent or app on, and to the servers the mount documents of the space on screen name. Nobody edits that list. A server joins it when the user creates an agent or app on it or moves an agent to it, and leaves it through the assistant panel's **Stop checking this server**. A space never names a local server as its own default, since only the computer running it can reach it. <!-- id:tQSjmGEz -->

The app environment needs no configuration per client for any of this. It answers signed requests from any origin and identifies a caller by the signed account, never by where the page was served. [Environments](../operate/environments.md) describes the servers themselves.

# Addresses

A mounted agent's screens are views of its document, addressed with a `:` term after the document's path. The base URL opens **Home**, the document itself.

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

`/:tools` opens the permissions page. On the root of a space, `/:settings` opens the space's settings, not an agent's. Session and message sharing links open Seed's web UI, never the app environment.

An agent without a document, and any session or run, also has a web address under `/hm/agents/`: `/hm/agents/agent/<id>?server=&tab=&trigger=&file=`, `/hm/agents/session/<id>?server=&agent=` and `/hm/agents/run/<id>?server=&agent=`. A copied web link opens in the desktop app.

# See also

- [Seed Agents](../agent.md)
- [Sharing an agent](./sharing.md)
- [Agent identity](./identity.md)
- [What an agent is told](./prompt.md)
- [Agents in the Seed app](./in-the-app.md)
- [Permissions](../protocol/permissions.md)
- [Environments](../operate/environments.md)
- [Signed API](../build/signed-api.md)
