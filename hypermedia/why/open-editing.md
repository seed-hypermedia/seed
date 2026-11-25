---
name: Open editing
summary: A document is a history of signed changes, which gives every document version history, branches you own and change requests, much like git.
---
The web has no built-in way to see how a page changed or who changed it. It also has no way to make your own version of someone else's page and keep their name on their work. Every wiki builds its own history system. Every copy loses the credit. <!-- id:q2qLRIDC -->

Hypermedia builds versions and authorship into the document itself. A [document](../protocol/documents.md) is a set of signed [changes](../change.md), each one building on earlier ones. Anyone with the data can replay it, make a branch of it, or offer their work back to the owner. <!-- id:lzWm7p7N -->

# Version history <!-- id:RsX15PfA -->

Each [version](../protocol/documents.md) of a document is a set of signed change [blobs](../protocol/blobs.md). Each change names the earlier changes it builds on. Together the changes form a graph with no loops, called a DAG. Every change is signed, so you can see who made each step. <!-- id:NoItdQc0 -->

To show a document at a version, the software sorts the changes by a fixed rule and applies them in order. Two people can edit at the same time. Fixed rules merge their edits, so the last save does not simply win. [Documents](../protocol/documents.md) explains the order and the merge rules.

A [Ref](../ref.md) is a small signed blob that says "at this path, the newest version is these changes". Refs make a document visible at an address. Readers accept a Ref only from the owner of the [space](../protocol/spaces.md) or from a key that holds a [capability](../protocol/permissions.md), which is a signed grant from the owner. <!-- id:LQooj9on -->

# Working together with permission <!-- id:BTJuVGh5 -->

Several authors can work on one document. The owner grants a capability to each of them. They publish changes and Refs, and readers accept those Refs because the capability is valid. If someone without permission publishes a Ref for a document, readers ignore it, and the document does not move. See [Permissions](../protocol/permissions.md). <!-- id:bN6v2FdU -->

# Editing without permission <!-- id:T60dXD1u -->

This part is open editing. You can change a document that you may not write to, as long as you publish your version in your own space. You publish a [Ref](../ref.md) at a path you control. It points at the original document's changes plus your own. That makes a new document address that you own. The full history stays, and each earlier change still carries the signature of its author. <!-- id:EHAaoegW -->

If the original author likes your work, they can update their own Ref to include your changes. They do not have to grant you any rights. So Refs give you branches and change requests in the protocol itself, much like pull requests. The model comes from git, the most widely used tool for tracking versions of code. One difference: in Hypermedia, identity and permission are part of the data. Git leaves them to the hosting service. <!-- id:gexJmNNO -->

# Comments have history too <!-- id:cWhKWFZL -->

[Comments](../protocol/comments.md) are edited in a lighter way. A [comment](../comment.md) blob carries its whole content. An edit publishes a new blob that replaces the old one and keeps the same identifier. A comment is small and has one author, so this stays cheap and still leaves a trail of versions. A document is larger and has many authors, so it gets the full graph of changes. <!-- id:EHsSOSt_ -->

# Limits <!-- id:tRA0aRlo -->

- You can fork a document with the [Seed CLI](../build/cli.md) and the [Seed app](../software/desktop.md).
- There is no operation to merge two Refs made at the same time back into one. There is no rebase and no revert.
- There are two [roles](../role.md), `WRITER` and `AGENT`. A grant covers a path and everything under it.
- A [capability](../protocol/permissions.md) cannot be taken back.

# See also <!-- id:LEr2-dr8 -->

- [Signed content](./signed-content.md) <!-- id:Xs9kNirF -->
- [The end of broken links](./broken-links.md) <!-- id:E3Ljo6dX -->
- [Documents](../protocol/documents.md) <!-- id:-iObHQ6Y -->
- [Change](../change.md) <!-- id:mZ_qC0hI -->
- [Ref](../ref.md) <!-- id:9tWkTtVZ -->
- [Permissions](../protocol/permissions.md) <!-- id:om2MDcAv -->
- [Comments](../protocol/comments.md) <!-- id:QBYCxOOv -->
