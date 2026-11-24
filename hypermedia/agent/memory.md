---
name: Memory
summary: An agent's memory is its own tree of files, read and written with the verbs, mounted into the code sandbox as /workspace, and open to the people the agent is shared with.
---
An [agent](../agent.md)'s **memory** is its own file tree, `~/memory/` in its [Space](./space.md). It belongs to one agent, and all of that agent's [sessions](./session.md) share it. An agent keeps notes, drafts and code there, for example `~/memory/notes/topic.md`. Anyone the agent is shared with can read it on the Memory tab of the [app](./in-the-app.md), and anyone with write access can change it.

Do not keep passwords, API keys or other secrets in memory. Declare a key an [app tool](../tool.md) needs in the app's private config instead.

Memory is a directory on the [app environment](../software/app-environment.md), the server that runs the agent. Files are UTF-8 text or binary. The agent reaches memory with [read](./read.md) and [write](./write.md). Code run by [execute](./code-execution.md) sees it as `/workspace`, and so do the agent's own [tools](../tool.md#memory) when its writers or its triggers call them (`ctx.memory`).

This page says how memory is read and written, and what is unsafe to keep there.

# Reading and writing

- `read ~/memory/<path>` returns a file, or a listing for a directory. The address table is on [read](./read.md#address-forms).
- `write ~/memory/<path>` replaces a file whole. There is no append. Options delete a path, download a URL to it, or save a [session attachment](./session.md) to it. See [write](./write.md#input-and-targets).
- Memory writes never need a [grant](./grants.md), and memory has no quota. A path can be at most 512 bytes and 16 levels deep.
- Each turn's [Space index](./space-index.md) carries a one-line summary of the top level of memory.
- A memory markdown file can be published as a [document](../protocol/documents.md) with `options.fromPath` on an `hm://` write. Any memory file can be published to IPFS. Both need the publish grant.

# What not to keep in /workspace

`/workspace` is shared. Only one sandbox holds an agent's memory directory at a time. But the calls of every open session, every delegated [child](./child.md) and every [trigger](../trigger.md) firing take turns on it. And the `read` and `write` [verbs](./tools.md) on the host touch the same files while a sandbox runs. The host and the sandbox do not share file caches or file locks. So two writers on one file at the same time can damage it. The rules:

- Do not keep a SQLite database under `/workspace`.
- Do not keep lock files, or any file that needs atomic or locked writes.
- Do not append to one shared log from several firings.
- Do not read a shared JSON file, change it, and write it back from code.
- Keep lasting state in memory files written whole with the `write` verb. Use one file per event or record, not one shared file that grows. Merge them later in a single run when you need a summary.
- Treat `disk I/O error`, `database is locked`, or a corrupt index under `/workspace` as two writers meeting on one file. The disk is fine. Move the state out of the shared file.

# See also

- [Space](./space.md)
- [Read](./read.md)
- [Write](./write.md)
- [Code execution](./code-execution.md)
- [Persistence](../operate/persistence.md)
- [Troubleshooting](../operate/troubleshooting.md)
