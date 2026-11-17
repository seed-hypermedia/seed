---
name: Sharing an agent
summary: An agent has one owner, invited collaborators who read or write it, and two switches that open it to every signed account, and each action on the server needs one of four access levels.
---
An [agent](../agent.md) belongs to the [account](../protocol/identity.md) that created it. The owner can share it with other accounts, or open it to everyone. This page covers who can do what with an agent on its app environment. It does not cover who can write the agent's [document](./mounting.md): those are Hypermedia [permissions](../protocol/permissions.md), and the two are kept separate.

# Roles

| Role | How an account gets it | What it can do |
| --- | --- | --- |
| **owner** | it created the agent | everything, including sharing and deleting |
| **writer** | invited and accepted | change the agent and work in its sessions |
| **reader** | invited and accepted, or any signed account when public read is on | inspect everything, change nothing |
| **chatter** | any signed account when public chat is on | read, and talk to the agent |

An account that has been invited and has not accepted yet is **pending**. It sees only the invitation: the agent's id and name, the owner, the role and the dates. The agent's contents stay hidden until the invite is accepted.

Everything the agent holds is stored under the owner's account, whatever the role of the account that acted.

# Access levels

Each action of the [signed API](../build/signed-api.md) needs one of four levels.

- **Reader level** covers reading the agent and all of its state: memory, tools, the prompt, sessions and their transcripts, attachments, triggers and [runs](./runs.md). Every role has it.
- **Chat level** covers creating a [session](./session.md), sending a message, uploading an attachment, and stopping or retrying a run. The owner, writers and chatters have it. Readers do not.
- **Writer level** covers editing the agent, its triggers, its memory and its tools, renaming and deleting sessions, cancelling or signalling a run, and running a verb as the user from the [wrench palette](./wrench-palette.md). The owner and writers have it.
- **Owner level** covers inviting and removing collaborators, the public switches, the agent's [signing identities](./identity.md), and deleting the agent.

Live [WebSocket subscriptions](../build/websocket-subscriptions.md) to an agent, a session or a run use the same check. Changes fan out to the account subscription of every accepted collaborator. Removing a collaborator takes effect before their next request or subscription.

# What sharing never gives

Model providers, secrets, sign-in credentials and signing identities belong to an account, not to an agent. A collaborator cannot change the owner's. When a collaborator opens a shared agent's settings, the server lists only the owner's redacted records needed to show and edit that agent: the owner sees every identity, and a collaborator sees only the identities granted to that agent. A writer who saves the agent must leave the set of granted identities unchanged, or the save is refused.

# Public access

Two switches, set by the owner, open an agent beyond its members.

- **Public read** makes every signed account that knows the agent's id a reader. It gets the same view an invited reader gets, live updates included. The agent still never appears in that account's list of agents or sessions.
- **Public chat** can be turned on only while public read is on, and turning public read off clears it. It makes those public readers chatters. A chatter may create, message, attach to and stop sessions. Everything at writer level is still refused.

Public chat is narrower than inviting a writer on purpose. Use public chat to let anyone talk to an agent. Use the writer role for people you trust to change it.

Every request to an app environment is signed, so there is no anonymous access: a reader who is not signed in cannot use even a public agent.

# In the app

A mounted agent's **People** tab is the one place for all of this. It merges two lists: the agent's collaborators (**Can view** is reader, **Can edit** is writer) and the writers of the agent's document. Inviting an editor also gives them a `WRITER` [capability](../protocol/permissions.md) on the agent's document when the inviter owns the space, so editors can change its instructions. A writer of the document who is not a collaborator shows with **Add as editor**. The owner sees pending invitations and the two public switches there. Below the list, **What this agent can write** shows the agent's own [write scope](./mounting.md).

An invited account finds the invitation on the agent's page, with an **Accept invite** button. No screen lists all of an account's pending invitations. An account the agent is not shared with is told so on that page; see [how a client finds a space's agents](./mounting.md).

In a shared agent, each message from a person carries the account that sent it and the exact key that signed it. The model is told the accepted members, their roles and their profile names, so it can tell the people in a conversation apart. See [what an agent is told](./prompt.md).

# The actions

`ListAgentInvites`, `AcceptAgentInvite` and `DeclineAgentInvite` are for the invited account. `ListAgentCollaborators`, `InviteAgentCollaborator`, `RemoveAgentCollaborator`, `SetAgentPublicRead` and `SetAgentPublicChat` manage access; all but the listing are owner only. Their shapes are in the [signed API](../build/signed-api.md).

# See also

- [Agents are documents](./mounting.md)
- [Agent identity](./identity.md)
- [Security model](./security.md)
- [Permissions](../protocol/permissions.md)
- [Signed API](../build/signed-api.md)
- [Agents in the Seed app](./in-the-app.md)
