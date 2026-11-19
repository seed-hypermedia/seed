---
name: Ref
summary: A signed claim, like a Git ref, that a path in a space points at the current head Changes of a document, or that the path is deleted or redirects elsewhere.
---
A **Ref** is the [blob](./protocol/blobs.md) that gives a [document](./protocol/documents.md) an address. [Changes](./change.md) hold the history. A Ref says: "this path in this [space](./protocol/spaces.md) shows these heads". The heads are the newest Changes. The [daemon](./software/daemon.md) checks permission on Refs. A Ref makes a document appear in listings and search. You also publish a Ref to branch, delete, move or redirect a document. <!-- id:od4IuOD_ -->

This page defines the **ref** blob type. A Ref starts with the signed [blob envelope](./blob.md). The formal schema is attached to this document as the `schemaDefinition` key of its metadata. So the app can show the schema and sign values of this type. <!-- id:5X7JPVaE -->

A Ref has one of three shapes: <!-- id:ABaZUnEP -->

- A **version Ref** has `genesisBlob` and one or more `heads`. It says which version the address shows.
- A **tombstone** has `genesisBlob` and no heads. It deletes the document at that path, once it is newer than the last live Ref of the same generation.
- A **redirect** has `genesisBlob`, no heads and a [redirect target](./ref/redirect-target.md). With `republish` set, the address keeps showing the target's content, and the redirect does not count as a deletion.

The [home document](./protocol/spaces.md) (empty `path`) can be neither a tombstone nor a redirect.

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
| `capability` | informational [CID](./cid.md) of the grant the signer relied on. The daemon never sets it and ignores it for authorisation. Publish the [Capability](./capability.md) blob itself instead. <!-- id:VTYN6xJ7 --> |

`space` is omitted when the signer owns the space. Any other signer must hold a [capability](./capability.md) for the path. Without one, the daemon sets the Ref aside and it has no effect. `generation` orders the lives of an address: the highest generation wins. A private Ref must have a path of one segment. [Documents](./protocol/documents.md) explains branching, deleting, moving, republishing and generations. <!-- id:CNUyMAhI -->

# See also <!-- id:_DOCd5Nd -->

- [Documents](./protocol/documents.md): heads and versions, generations and takeover, branching, deleting, moving. <!-- id:NnRrjyyg -->
- [Permissions](./protocol/permissions.md): who may sign a Ref for a path. <!-- id:1PwTTRT6 -->
- [Privacy](./protocol/privacy.md): what a private Ref means. <!-- id:283yXuwj -->
- [Seed API](./build/web-api.md): `Resource` returns a document, a redirect or a tombstone. <!-- id:6dVqgLC7 -->
- [change](./change.md): the blobs a Ref's heads point at. <!-- id:icR4eZUw -->
- [ref/redirect-target](./ref/redirect-target.md): where a redirect sends readers. <!-- id:DW3vxLxf -->

# Pages in this section <!-- id:K17RQNDO attrs:{"childrenType":"Grid","columnCount":3} -->

<./ref/redirect-target.md> <!-- id:hNttLyOl type:Embed attrs:{"view":"Card"} -->
