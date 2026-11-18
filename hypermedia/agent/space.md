---
name: Space
summary: An agent's Space is everything it has, as one tree of memory files, tools, triggers and its own definition.
---
A **Space** is everything an [agent](../agent.md) has, as one tree. `~/memory/` holds its files. `~/tools/` holds its [tool documents](./tool-document.md). `~/triggers/` holds its [triggers](../trigger.md). `~/self` holds its own definition, which it can read and cannot change. The agent reaches all of it with two verbs, [read](./read.md) and [write](./write.md). <!-- id:EioLizGD -->

For example, `read ~/memory/notes.md` returns a note the agent saved in an earlier conversation, and `write ~/triggers/…` creates a rule that makes the agent act every morning.

The Space is one of the three nouns of the runtime, beside the [Log](./log.md) and [Runs](./runs.md). The Space is what an agent *has*. The log is what happened. Runs are what executes. This page says what is in each branch, who can change it, and how the model learns what its Space holds.

Do not confuse it with a Hypermedia [space](../protocol/spaces.md), which is the tree of documents that belongs to one account.

# One tree, two verbs

There is no separate tool for memory, for tools or for triggers. Each is a path under `~`, and the same two verbs reach all of them. A new kind of thing an agent can have arrives as a new path, not as a new tool.

The agent's owner reads the same tree. The Memory, Triggers and Settings tabs of the [app](./in-the-app.md) show the same content. A person can also run `read` on any of these paths by [running a tool themselves](./wrench-palette.md).

| Path | Holds | Read | Write |
| --- | --- | --- | --- |
| `~/memory/` | the agent's own files | a file, or a directory listing | replaces a file whole; never gated by a grant |
| `~/tools/` | one tool document per tool the agent holds | a tool's [contract](./contract.md); the bare path lists the verbs and everything [callable](./callables.md) | refused |
| `~/triggers/` | the agent's triggers | one trigger with its recent firings; the bare path lists all | creates, edits, enables, disables or deletes a trigger |
| `~/self` | the agent's own record | definition, stored prompt, owner's account id, [delegation budget](./delegation-budgets.md), grants, signing-key names, triggers, memory summary, [session](./session.md) count | refused: the definition is the owner's to edit |

The exact behaviour of each address is in the [read](./read.md) and [write](./write.md) references.

# Memory

`~/memory/` is a directory on the [app environment](../software/app-environment.md). It belongs to one agent, and all of that agent's sessions share it. An agent keeps notes, drafts and reusable code there between conversations.

- Code run by [`execute`](./code-execution.md) sees the same directory as `/workspace`, except `~/memory/private/`.
- `~/memory/private/` is for the owner only. Code never sees it.
- Memory has no size limit.

See [memory](./memory.md).

# Tools

`~/tools/` holds the tools the agent can run: the built-in callables, and one document per tool of each enabled [MCP server](./mcp.md). An agent cannot write here.

A tool that an agent makes is a different thing. It is a [tool](../tool.md) document, published under the agent's own [document](./mounting.md) or under an app, and called by its `hm://` URL. See [tool resources](./call.md#tool-resources) and [Tool](../tool.md).

# Triggers

`~/triggers/` holds the agent's standing rules for acting when nobody asked. An agent manages its own triggers, and nobody has to approve them. See [triggers](./triggers.md), and the [security model](./security.md) for what that means.

# Self

`~/self` is the agent's **definition** and what follows from it: its name, model and provider, [reasoning level](./reasoning-levels.md), [thoroughness](./delegation-budgets.md), [grants](./grants.md), enabled MCP servers and the names of its [signing keys](./identity.md). It never shows secrets or provider keys.

The agent cannot change `~/self`. The owner and writers change it in Settings, or with `UpdateAgent` in the [signed API](../build/signed-api.md).

`~/self` shows only the prompt stored in the definition. For an agent that has a [document](../protocol/documents.md), the real instructions are that document. The agent can read it and, with write access, edit it like any other document. See [Agents are documents](./mounting.md).

# How the model knows what it has

The model is not given the contents of its Space. With every turn it gets the [Space index](./space-index.md): a short text that names each tool, sums up the top level of memory, and names the active triggers. It reads the rest when it needs it.

# Where it is stored

Memory is a directory on disk, in the agent's state directory under the server's data directory. Tool documents and triggers are rows in the server's database. All of it belongs to the [account](../protocol/identity.md) that owns the agent, and the server removes it when the agent is deleted. See [persistence](../operate/persistence.md).

Agents do not share a Space. Each agent's memory and tools are its own, and one agent cannot read another's.

# See also <!-- id:kQqcxElO -->

- [Log](./log.md) <!-- id:t_95Dj9v -->
- [Runs](./runs.md) <!-- id:552EjNLC -->
- [Space index](./space-index.md) <!-- id:casV-bvm -->
- [Memory](./memory.md)
- [Read](./read.md) <!-- id:EMS-WS-y -->
- [Write](./write.md) <!-- id:e2h6EPIo -->
- [Tool document](./tool-document.md) <!-- id:ZuXftQGQ -->
- [Tools](./tools.md) <!-- id:6iryegTJ -->
