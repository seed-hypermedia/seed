---
name: Open editing
summary: Why documents are histories of signed changes, how that gives the web version history, branching and change requests, and where the git analogy stops.
---
The web has no built-in way to track how a page changed or who changed it. It also has no way to make your own version of someone else's page while keeping their authorship intact. Every wiki builds its own history system, and every fork is a copy with the credit stripped.

Hypermedia builds versioning and authorship into the document itself. A [document](../protocol/documents.md) is a graph of signed [changes](../change.md). Anyone with the data can replay it, branch it, or propose their work back to the owner.

# Version history

Each [version](../protocol/documents.md) of a document is a set of signed change [blobs](../protocol/blobs.md). Each change names the earlier changes it builds on, so the changes form a graph with no cycles, a DAG. Every change is signed, so you can see exactly who made each step. To show a document at a version, the changes are sorted deterministically and applied in order. Concurrent edits merge by fixed rules, and the last save does not simply win. [Documents](../protocol/documents.md) explains the ordering and the CRDT.

A [Ref](../ref.md) is the small signed blob that says "at this path, the current version is these change heads." Refs make a document visible at an address. Only the [space](../protocol/documents.md) owner or a holder of a [capability](../capability.md) can publish a Ref that readers will honor.

# Collaboration with permission

Several authors can work on one document. The owner grants a capability to each collaborator. Collaborators publish changes and Refs, and readers accept those Refs because the capability checks out. If someone without permission publishes a Ref for a document, readers ignore it and the document does not move. See [Permissions](../protocol/permissions.md).

# Editing without permission

The team calls this part open editing. You can change a document you cannot write to, as long as you publish your version in your own space. You publish a [Ref](../ref.md) at a path you control that points at the original document's changes plus your own. That creates a new document URL that you own. The full history stays intact, and every earlier change is still signed by its original author.

If the original author likes your work, they can update their own Ref to include your changes, without granting you any future rights. So Refs give you branches and change requests, much like pull requests, in the protocol itself. The model comes from git, the most successful distributed version control system. One difference: in Hypermedia, identity and permission live in the data, where git leaves them to the hosting service.

# Comments have history too

[Comments](../protocol/comments.md) use a lighter mechanism for edits. A [comment](../comment.md) blob carries its whole content. An edit publishes a new blob that replaces the old one and keeps the same identifier. Small, single-author pieces stay cheap and still leave a version trail. Documents are larger and have many authors, so they get the full change graph.

# What ships today

- Change graphs, deterministic ordering, and Refs with versions, tombstones, redirects and republishing. See [Documents](../protocol/documents.md) and [Ref](../ref.md).
- Capabilities with the roles writer and agent, scoped by path prefix. See [Permissions](../protocol/permissions.md).
- Forking in the [Seed CLI](../build/cli.md) and the [app](../apps/desktop.md). Since late 2025 the app's interface gives the branch feature less weight while the team reconsiders how to present branches. The protocol mechanism has not changed.

# What is still direction

Merging two concurrent Refs back into one, rebase, and revert do not exist as operations yet. The team is also redesigning how a document's location relates to its authority, which affects how moves and branches will work. See [Where this is going](../protocol/roadmap.md).

# See also

- [Signed content, not server trust](./signed-content.md)
- [The end of broken links](./broken-links.md)
- [Documents](../protocol/documents.md)
- [Change](../change.md)
- [Ref](../ref.md)
- [Permissions](../protocol/permissions.md)
- [Comments](../protocol/comments.md)
