---
name: Open editing
summary: Why documents are histories of signed changes, how that gives the web version history, branching and change requests, and what the git analogy does and does not cover.
---
The web has no native way to track how a page changed, who changed it, or to make your own version of someone else's page while keeping their authorship intact. Every wiki has to build its own history system, and every fork is a copy with the credit stripped.

Hypermedia builds versioning and authorship into the document itself. A document is a graph of signed [changes](../change.md), and anyone with the data can replay it, branch it, or propose their work back to the owner.

# Version history

Each version of a document is a set of signed change blobs. Each change names the previous changes it builds on, so the changes form a graph with no cycles, a DAG. Because every change is signed, you can see precisely who did each step. To show a document at a version, the changes are sorted deterministically and applied in order; concurrent edits merge by fixed rules rather than by whoever saved last. [Documents](../protocol/documents.md) explains the ordering and the CRDT.

A [Ref](../ref.md) is the small signed blob that says "at this path, the current version is these change heads." Refs are what make a document visible at an address. Only the space owner or a holder of a [capability](../capability.md) can publish a Ref that readers will honor.

# Collaboration with permission

Several authors can work on one document. The owner grants a capability to each collaborator; collaborators publish changes and Refs; readers accept those Refs because the capability checks out. If someone without permission publishes a Ref for a document, readers ignore it and the document does not move.

# Editing without permission

The part the team calls open editing: you can change a document you do not have write access to, as long as you publish your version in your own space. You publish a Ref at a path you control that points at the original document's changes plus your own. That creates a new document URL that you own, with the full history intact and every earlier change still signed by its original author.

If the original author likes your work, they can update their own Ref to include your changes, without granting you any future rights. Refs therefore give you branches and change requests, much like pull requests, at the protocol level. The model is borrowed from git, the most successful distributed version control system, with the difference that identity and permission are part of the data rather than of the hosting service.

# Comments have history too

Comments are edited by a lighter mechanism. A [comment](../comment.md) blob carries its whole content, and an edit publishes a new blob that replaces the old one, keeping the same identifier. That keeps small, single-author pieces cheap while still leaving a version trail. Documents, which are larger and multi-author, get the full change graph.

# What ships today

- Change graphs, deterministic ordering, and Refs with versions, tombstones, redirects and republishing. See [Documents](../protocol/documents.md) and [Ref](../ref.md).
- Capabilities with the roles writer and agent, scoped by path prefix. See [Permissions](../protocol/permissions.md).
- Forking in the Seed CLI and the app. The app's branch feature has been de-emphasised in the interface since late 2025 while the team reconsiders how branches should be presented; the protocol mechanism has not changed.

# What is still direction

Merging two concurrent Refs back into one, rebase, and revert are not first-class operations yet. The team is also redesigning how a document's location and its authority relate, which affects how moves and branches will work; see [Where this is going](../protocol/roadmap.md).

# See also

- [Signed content, not server trust](./signed-content.md)
- [Change](../change.md), [Ref](../ref.md), [Documents](../protocol/documents.md)
