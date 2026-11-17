---
name: Memory
summary: An agent's memory is its private file tree, read and written with the verbs and mounted into the code sandbox as /workspace.
---
An agent's **memory** is its private file tree, `~/memory/` in its [Space](./space.md). It is a directory on the app environment that belongs to one agent. Files are UTF-8 text or binary. The agent reaches it with [read](./read.md) and [write](./write.md), code run by [execute](./code-execution.md) sees it as `/workspace`, and the owner sees it on the Memory tab of the [app](./in-the-app.md). This page says how memory is read and written, what the `private/` part is, and what is unsafe to keep there.

# Reading and writing

- `read ~/memory/<path>` returns a file, or a listing for a directory. The address table is on [read](./read.md#address-forms).
- `write ~/memory/<path>` replaces a file whole. There is no append. Options delete a path, download a URL to it, or save a session attachment to it. See [write](./write.md#input-and-targets).
- Memory writes are never gated by a [grant](./grants.md), and they have no size ceiling.
- Each turn's [Space index](./space-index.md) carries a one-line summary of top-level memory.
- A memory markdown file can be published as a document with `options.fromPath` on an `hm://` write, and any memory file can be published to IPFS. Both need the publish grant.

# Private memory

The path `~/memory/private/` is owner-only. It is stored outside the directory that is mounted into code sandboxes. Only a signed action from the agent's owner, or an interactive run the owner started, can read or write it. Other runs get a 403.

# What not to keep in /workspace

`/workspace` is a shared mount. Only one sandbox holds an agent's memory directory at a time, but the calls of every open session, every delegated [child](./child.md) and every [trigger](../trigger.md) firing take turns on it, and the host side [read](./read.md) and [write](./write.md) verbs touch the same files while a sandbox runs. Page caches and file locks are not coherent between the host and a guest, so two writers on one file at the same time can tear it. The rules:

- Do not keep a SQLite database under `/workspace`.
- Do not keep lock files, or any file that needs atomic or locked writes.
- Do not append to one shared log from several firings.
- Do not read a shared JSON file, change it, and write it back from code.
- Keep durable state in memory files written whole with the [write](./write.md) verb. Prefer one file per event or record over appending to a shared file. Merge them later in a single run when you need a summary.
- Treat `disk I/O error`, `database is locked`, or a corrupt index under `/workspace` as two writers colliding. The disk is fine. Move the state out of the shared file.

# See also

- [Space](./space.md)
- [Read](./read.md)
- [Write](./write.md)
- [Code execution](./code-execution.md)
- [Persistence](../operate/persistence.md)
- [Troubleshooting](../operate/troubleshooting.md)
