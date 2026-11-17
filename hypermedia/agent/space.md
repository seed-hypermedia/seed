---
name: Space
summary: An agent's Space is everything it has, as one addressable tree of memory files, tools, triggers, and its own definition.
---
**Space**: everything an agent has, as one addressable tree. `~/memory/` holds its files, `~/tools/` its [tool documents](./tool-document.md), `~/triggers/` its [triggers](../trigger.md), and `~/self` its own definition, which is read-only. Configuration is content, so the agent changes it with [read](./read.md) and [write](./write.md). <!-- id:EioLizGD -->

The Space is one of the three nouns of the runtime, beside the [Log](./log.md) and [Runs](./runs.md). The Space is what an agent *has*. The log is what happened, and runs are what executes. This page says what is in each branch, who can change it, and how the model learns what its Space holds.

# One tree, two verbs

There is no separate tool for memory, for tools or for triggers. Each is a path under `~`, and the same two verbs reach all of them. A new kind of thing an agent can have arrives as a new path, not as a new tool. The agent's owner reads the same tree: the Memory, Triggers and Settings tabs of the [app](./in-the-app.md) show the same content, and a person can run `read` on any of these paths from the [wrench palette](./wrench-palette.md).

| Path | Holds | Read | Write |
| --- | --- | --- | --- |
| `~/memory/` | the agent's private files | a file, or a directory listing | replaces a file whole; never gated by a grant |
| `~/tools/` | one tool document per tool the agent holds | a tool's [contract](./contract.md); the bare path lists the verbs and everything callable | refused |
| `~/triggers/` | the agent's triggers | one trigger with its recent firings; the bare path lists all | creates, edits, enables, disables or deletes a trigger |
| `~/self` | the agent's own record | definition, delegation budget, grants, signing-key names, triggers, memory summary, session count | refused: the definition is the owner's to edit |

The exact behaviour of each address is in the [read](./read.md) and [write](./write.md) references.

# Memory

`~/memory/` is a directory on the app environment that belongs to one agent and is shared by all of its sessions. It is where an agent keeps notes, drafts and reusable code between conversations. Code run by `execute` sees the same directory as `/workspace`. The path `~/memory/private/` is for the owner only. Memory has no size quota. See [memory](./memory.md).

# Tools

`~/tools/` holds the tools the agent can run: the built-in callables and one document per tool of each enabled [MCP server](./mcp.md). An agent cannot write here. A tool an agent makes is a [tool](../tool.md) document published under the agent's own [document](./mounting.md) or under an app, and called by its `hm://` URL. See [tool document](./tool-document.md) and [callables](./callables.md).

# Triggers

`~/triggers/` holds the agent's standing rules for acting when nobody asked. An agent manages its own triggers, with no approval step. See [triggers](./triggers.md), and the [security model](./security.md) for what that means.

# Self

`~/self` is the agent's **definition** and what follows from it: its name, model and provider, reasoning level, thoroughness, [grants](./grants.md), enabled MCP servers and the names of its [signing keys](./identity.md). It never shows secret material or provider keys. The agent cannot change it. The owner and writers change it in Settings, or with `UpdateAgent` in the [signed API](../build/signed-api.md).

The agent's instructions are not in the tree. For a mounted agent they are its [document](./mounting.md), which the agent can read and, with write access, edit like any other document.

# How the model knows what it has

The model is not handed the contents of its Space. With every turn it gets the [Space index](./space-index.md): a short block that names each tool, summarises the top level of memory, and names the active triggers. It reads the rest when it needs it.

# Where it is stored

Memory is a directory on disk, in the agent's state directory under the server's data directory. Tool documents and triggers are rows in the server's database. All of it belongs to the account that owns the agent and is removed when the agent is deleted. See [persistence](../operate/persistence.md).

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
