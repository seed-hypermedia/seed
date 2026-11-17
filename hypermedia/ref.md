---
name: Ref
summary: A signed claim, like a Git ref, that a path in a space points at the current head Changes of a document, or that the path is deleted or redirects elsewhere.
---
A **Ref** is the blob that gives a [document](./protocol/documents.md) an address. [Changes](./change.md) describe history. A Ref says "this path in this space currently shows these heads". The daemon checks Refs for permission. A Ref is what makes a document appear in listings and search, and you publish one to branch, delete, move or redirect a document. <!-- id:od4IuOD_ -->

This page defines the **ref** blob type, a Hypermedia network blob that extends the signed [blob](./blob.md) envelope. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and sign values of this type. <!-- id:5X7JPVaE -->

Three shapes are valid. A **version Ref** has `genesisBlob` and one or more `heads`, and asserts a version. A **tombstone** has `genesisBlob` and no heads, and deletes the document at that path once it is newer than the last live Ref of the same generation. A **redirect** has `genesisBlob`, no heads and a [redirect target](./ref/redirect-target.md). With `republish` set, a redirect keeps showing the target's content under this address and does not count as a deletion. The home document (empty `path`) may be neither a tombstone nor a redirect. <!-- id:ABaZUnEP -->

# Fields

A Ref adds these fields to the signed [blob](./blob.md) envelope:

<!-- id:exQijQ7E -->
| key <!-- col:ZQ8Vpyx0 --> | meaning <!-- col:lexYQOQi --> <!-- id:lK27WJw5 --> |
| --- | --- |
| `space` | the [account](./protocol/identity.md) whose namespace the path lives in; omitted when it equals `signer`. <!-- id:HHpSjaV7 --> |
| `path` | the path inside the space; empty for the home document. Must start with `/`, must not end with `/`, and may not contain single or double quotes, backslashes, NUL, tab, CR or LF. <!-- id:NyJ_Zq8k --> |
| `genesisBlob` | the genesis of the document. Required by the indexer. <!-- id:o9WrppxN --> |
| `heads` | the version this Ref asserts. Empty for a tombstone or a redirect. <!-- id:r69jLlUd --> |
| `redirect` | `{space?, path?, republish?}`: where readers should go instead. <!-- id:6mMcULge --> |
| `generation` | a number that orders successive lives of the address; see below. <!-- id:WF1b-MBl --> |
| `visibility` | empty for public, `"Private"` for private; see [Privacy](./protocol/privacy.md). <!-- id:ZlYPwFPW --> |
| `capability` | informational CID of the grant the signer relied on. The daemon never sets it and ignores it for authorisation. Publish the [Capability](./capability.md) blob itself instead. <!-- id:VTYN6xJ7 --> |

`space` is omitted when the signer is the space owner. Otherwise the signer must hold a [capability](./capability.md) for the path, or the Ref is stashed and has no effect. `generation` orders the lives of an address: the highest generation wins. A private Ref must have a single-segment path. [Documents](./protocol/documents.md) explains branching, deleting, moving, republishing and generations. <!-- id:CNUyMAhI -->

# See also <!-- id:_DOCd5Nd -->

- [Documents](./protocol/documents.md): heads and versions, generations and takeover, branching, deleting, moving. <!-- id:NnRrjyyg -->
- [Permissions](./protocol/permissions.md): who may sign a Ref for a path. <!-- id:1PwTTRT6 -->
- [Privacy](./protocol/privacy.md): what a private Ref means. <!-- id:283yXuwj -->
- [Seed API](./build/web-api.md): `Resource` returns a document, a redirect or a tombstone. <!-- id:6dVqgLC7 -->
- [change](./change.md): the blobs a Ref's heads point at. <!-- id:icR4eZUw -->
- [ref/redirect-target](./ref/redirect-target.md): where a redirect sends readers. <!-- id:DW3vxLxf -->

# Pages in this section <!-- id:K17RQNDO attrs:{"childrenType":"Grid","columnCount":3} -->

<./ref/redirect-target.md> <!-- id:hNttLyOl type:Embed attrs:{"view":"Card"} -->
