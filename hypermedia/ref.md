---
name: Ref
summary: A signed claim, like a Git ref, that a path in a space points at the current head Changes of a document, or that the path is deleted or redirects elsewhere.
---
A **Ref** is the blob that gives a [document](./protocol/documents.md) an address. [Changes](./change.md) describe history. A Ref says "this path in this space currently shows these heads". The daemon checks Refs for permission. A Ref is what makes a document appear in listings and search, and you publish one to branch, delete, move or redirect a document. <!-- id:od4IuOD_ -->

This page defines the **ref** blob type, a Hypermedia network blob that extends the signed [blob](./blob.md) envelope. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and sign values of this type. <!-- id:5X7JPVaE -->

Three shapes are valid. A **version Ref** has `genesisBlob` and one or more `heads`, and asserts a version. A **tombstone** has `genesisBlob` and no heads, and deletes the document at that path once it is newer than the last live Ref of the same generation. A **redirect** has `genesisBlob`, no heads and a [redirect target](./ref/redirect-target.md). With `republish` set, a redirect keeps showing the target's content under this address and does not count as a deletion. The home document (empty `path`) may be neither a tombstone nor a redirect. <!-- id:ABaZUnEP -->

`space` is omitted when the signer is the space owner. Otherwise the signer must hold a [capability](./capability.md) for the path, or the Ref is stashed and has no effect. The `capability` field is informational only and the daemon ignores it, so publish the Capability blob itself. `generation` orders the lives of an address: the highest generation wins. The daemon's `CreateRef` asks for a higher generation before it replaces a document with a different genesis, and clients use the current time in milliseconds for a new document. `visibility` is empty for public or `Private`, and a private Ref must have a single-segment path. Paths must start with `/`, must not end with `/`, and may not contain single or double quotes, backslashes, NUL, tab, CR or LF. [Documents](./protocol/documents.md) gives the reasoning behind each rule. <!-- id:CNUyMAhI -->

# See also <!-- id:_DOCd5Nd -->

- [Documents](./protocol/documents.md): heads and versions, generations and takeover, branching, deleting, moving. <!-- id:NnRrjyyg -->
- [Permissions](./protocol/permissions.md): who may sign a Ref for a path. <!-- id:1PwTTRT6 -->
- [Privacy](./protocol/privacy.md): what a private Ref means. <!-- id:283yXuwj -->
- [Seed API](./build/web-api.md): `Resource` returns a document, a redirect or a tombstone. <!-- id:6dVqgLC7 -->
- [change](./change.md): the blobs a Ref's heads point at. <!-- id:icR4eZUw -->
- [ref/redirect-target](./ref/redirect-target.md): where a redirect sends readers. <!-- id:DW3vxLxf -->
