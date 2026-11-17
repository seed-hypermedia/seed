---
name: Sharing an agent
summary: An agent has one owner, invited collaborators who read or write it, and two switches that open it to every signed account, and each action on the server needs one of four access levels.
---
An [agent](../agent.md) belongs to the [account](../protocol/identity.md) that created it. The owner can share it with other accounts, or open it to everyone. For example, you can invite a colleague as a writer, so they can chat with your agent and change its settings.

This page covers who can do what with an agent on its [app environment](../software/app-environment.md). It does not cover who can write the agent's [document](./mounting.md). Those are Hypermedia [permissions](../protocol/permissions.md), and the two are separate.

# Roles

A **collaborator** is an account the owner invited. There are four roles.

| Role | How an account gets it | What it can do |
| --- | --- | --- |
| **owner** | it created the agent | everything, including sharing and deleting |
| **writer** | invited and accepted | change the agent and work in its sessions |
| **reader** | invited and accepted, or any signed account when public read is on | see everything, change nothing |
| **chatter** | any signed account that is not a collaborator, when public chat is on | read, and talk to the agent |

An account that was invited and has not accepted yet is **pending**. It sees only the invitation: the agent's id and name, the owner, the role and the dates. The agent's contents stay hidden until the account accepts.

Everything the agent holds is stored under the owner's account, whatever the role of the account that acted.

# Access levels

Each action of the [signed API](../build/signed-api.md) needs one of four **access levels**.

- **Reader level**: read the agent and everything it holds: memory, tools, the prompt, sessions and their transcripts, attachments, [triggers](../trigger.md) and [runs](./runs.md). Every role has it.
- **Chat level**: create a [session](./session.md), send a message, upload an attachment, and stop or retry a run. The owner, writers and chatters have it. Readers do not.
- **Writer level**: edit the agent, its triggers, its memory and its tools; rename and delete sessions; cancel or signal a run; and [run a tool yourself](./wrench-palette.md) in a session. The owner and writers have it.
- **Owner level**: invite and remove collaborators, set the public switches, manage the agent's [signing identities](./identity.md), and delete, adopt or orphan the agent.

Live [WebSocket subscriptions](../build/websocket-subscriptions.md) to an agent, a session or a run use the same check. The server sends changes to the account subscription of every accepted collaborator. When the owner removes a collaborator, that account's next request or subscription is refused.

# What sharing never gives

[Model providers](./model-providers.md), secrets, sign-in credentials and signing identities belong to an account, not to an agent. A collaborator cannot change the owner's.

When a collaborator opens a shared agent's settings, the server lists only what is needed to show and edit that agent, with secrets left out. The owner sees every identity. A collaborator sees only the identities granted to that agent. A writer who saves the agent must leave the set of granted identities unchanged, or the server refuses the save.

# Public access

Two switches, set by the owner, open an agent to accounts that were not invited.

- **Public read** makes every signed account that knows the agent's id a reader. It gets the same view an invited reader gets, with live updates. The agent still never appears in that account's list of agents or sessions.
- **Public chat** makes those public readers chatters. A chatter may create sessions, send messages, attach files and stop sessions. Everything at writer level is still refused. Public chat can be turned on only while public read is on, and turning public read off turns it off.

An account you invited as a reader stays a reader even when public chat is on. To let that person chat, make them a writer or remove the invitation.

Public chat gives less than the writer role, on purpose. Use public chat to let anyone talk to an agent. Use the writer role for people you trust to change it.

Every request to an app environment is signed, so nobody can use an agent without signing in, not even a public agent.

# In the app

The **People** tab of an agent that has a document is the one place for all of this. It merges two lists: the agent's collaborators (**Can view** is reader, **Can edit** is writer) and the writers of the agent's [document](../protocol/documents.md).

- Inviting an editor also gives them a `WRITER` [capability](../capability.md) on the agent's document when the inviter owns the space. So editors can change the agent's instructions.
- A writer of the document who is not a collaborator shows with **Add as editor**.
- The owner sees pending invitations and the two public switches there.
- Below the list, **What this agent can write** shows the agent's own [write scope](./mounting.md).

An invited account finds the invitation on the agent's page, with an **Accept invite** button. No screen lists all of an account's pending invitations. An account the agent is not shared with is told so on that page; see [how a client finds a space's agents](./mounting.md).

In a shared agent, each message from a person carries the account that sent it and the exact key that signed it. The model is told the accepted members, their roles and the names on their [profiles](../profile.md). So it can tell the people in a conversation apart. See [what an agent is told](./prompt.md).

# The actions

- `ListAgentInvites`, `AcceptAgentInvite` and `DeclineAgentInvite` are for the invited account.
- `ListAgentCollaborators`, `InviteAgentCollaborator`, `RemoveAgentCollaborator`, `SetAgentPublicRead` and `SetAgentPublicChat` manage access. Only the owner may use them, except the listing.

Their shapes are in the [signed API](../build/signed-api.md).

# See also

- [Agents are documents](./mounting.md)
- [Agent identity](./identity.md)
- [Security model](./security.md)
- [Permissions](../protocol/permissions.md)
- [Signed API](../build/signed-api.md)
- [Agents in the Seed app](./in-the-app.md)
