---
name: Ref
summary: A signed claim, like a Git ref, that a path in a space points at the current head Changes of a document, or that the path is deleted or redirects elsewhere.
schemaDefinition: ipfs://bafyreiduqxxs33cs7fat6cnc426whpk6jdrl5ayrg5ov6iwn3xioyoutde
---
A Ref is the blob that gives a document an address. Changes describe history; a Ref says "this path in this space currently shows these heads". It is the object the daemon checks for permission, the object that makes a document appear in listings and search, and the object you publish to branch, delete, move or redirect a document. <!-- id:od4IuOD_ -->

This page defines the **ref** blob type, a Hypermedia network blob that extends the signed [blob](./blob.md) envelope. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and sign values of this type. <!-- id:5X7JPVaE -->

Three shapes are valid. A **version Ref** has `genesisBlob` and one or more `heads`, and asserts a version. A **tombstone** has `genesisBlob` and no heads, and deletes the document at that path once it is newer than the last live Ref of the same generation. A **redirect** has no heads and a [redirect target](./ref/redirect-target.md); with `republish` set it keeps showing the target's content under this address instead of counting as a deletion. The home document (empty `path`) may be neither a tombstone nor a redirect. <!-- id:ABaZUnEP -->

`space` is omitted when the signer is the space owner. Otherwise the signer must hold a [capability](./capability.md) for the path, or the Ref is stashed and has no effect; the `capability` field is informational only and the daemon ignores it, so publish the Capability blob itself. `generation` orders the lives of an address: the highest generation wins, a Ref with a different genesis needs a higher generation, and clients use the current time in milliseconds for a new document. `visibility` is empty for public or `Private`, and a private Ref must have a single-segment path. Paths must start with `/`, must not end with `/`, and may not contain quotes, backslashes or control characters. The reasoning behind each of these rules is in [Documents](./protocol/documents.md). <!-- id:CNUyMAhI -->

# Shape <!-- id:dpE2fWQB -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:6u-Qshey -->
  - `type` — `"Ref"` <!-- id:4LKiQ2kT -->
  - `space` — [principal](./principal.md) <!-- id:idNr9FJM -->
  - `path` — [string](./string.md) <!-- id:8izgFQy0 -->
  - `genesisBlob` — [cid](./cid.md) <!-- id:cob0_GUo -->
  - `capability` — [cid](./cid.md) <!-- id:Wv5xpNAJ -->
  - `heads` _(required)_ — list of [cid](./cid.md) <!-- id:_B1tM30h -->
  - `redirect` — [ref/redirect-target](./ref/redirect-target.md) <!-- id:F5YoHwBj -->
  - `generation` — [integer](./integer.md) <!-- id:tPhi-Hlj -->
  - `visibility` — [visibility](./visibility.md) <!-- id:CgsyURu- -->

# Depends on <!-- id:L4KMjf3U -->

- [blob](./blob.md) <!-- id:qR-dN0GK -->
- [cid](./cid.md) <!-- id:h6XHAqQF -->
- [principal](./principal.md) <!-- id:CCI4-2aZ -->
- [ref/redirect-target](./ref/redirect-target.md) <!-- id:x_NaRzFr -->
- [visibility](./visibility.md) <!-- id:CDnB2GqZ -->
- [integer](./integer.md) <!-- id:1vZFCegM -->
- [string](./string.md) <!-- id:B2_Qyt3Z -->

# See also <!-- id:_DOCd5Nd -->

- [Documents](./protocol/documents.md): heads and versions, generations and takeover, branching, deleting, moving. <!-- id:NnRrjyyg -->
- [Permissions](./protocol/permissions.md): who may sign a Ref for a path. <!-- id:1PwTTRT6 -->
- [Privacy](./protocol/privacy.md): what a private Ref means. <!-- id:283yXuwj -->
- Read models: [Resource](./rpc/resource.md), [ResourceRedirect](./rpc/type/resource-redirect.md), [ResourceTombstone](./rpc/type/resource-tombstone.md). <!-- id:6dVqgLC7 -->
