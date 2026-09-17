---
name: Document
summary: The read model of a Hypermedia document, the metadata and block tree that result from replaying its Changes, and the base every typed document's attributes are folded into.
schemaDefinition: ipfs://bafyreib5e75e5btubdpbkpn7iifyxcnh2ekphhm4bq4wr3vsoeom6dbz6e
---
The base Hypermedia document — resolved metadata (including the schema-binding fields `attributesSchema`, `childAttributesSchema`, `schemaDefinition`) plus the content block tree. A typed document does not extend this: it names an attributes schema — a struct describing its metadata fields — through `attributesSchema`, or inherits one from its parent's `childAttributesSchema`. <!-- id:qIPS3d4t -->

This page defines the **document** value: not a signed network blob but the resolved state that the daemon computes from a document's Changes and hands to readers. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show and validate values of this shape. <!-- id:Kc-oFVmL -->

A document on the wire is a graph of [Change](./change.md) blobs and a [Ref](./ref.md) that names its heads; there is no blob whose bytes are "the document". What you get back from the API, the CLI, or the SDK is this value: `metadata`, the merged result of every SetAttributes register, and `content`, the tree of [block nodes](./block/node.md) produced by the move tree and the per-block registers. The API's full read model adds what the schema leaves out: the account and path, the version string, the authors, timestamps, the genesis, and the detached blocks; see [Resource document](./rpc/type/resource-document.md). <!-- id:OBypN7it -->

The three schema-binding metadata keys make typing work without touching this shape. `attributesSchema` names the struct this document's metadata must satisfy; `childAttributesSchema` names the struct its children must satisfy; `schemaDefinition` says this document defines a schema for others to reference. A typed document is still exactly this value, with the base metadata keys folded in beneath the type's fields. [Typed documents](./schema/typed-documents.md) has the rules; [Documents](./protocol/documents.md) has the history model behind the value. <!-- id:7PTJUigg -->

# Shape <!-- id:2f5svJlU -->

A **closed struct** with these fields: <!-- id:3x9xTU5x -->
  - `metadata`: [metadata](./metadata.md) <!-- id:JqWmcBXD -->
  - `content`: list of [block/node](./block/node.md) <!-- id:7I3IBxKI -->

# Depends on <!-- id:S3YgMiYc -->

- [block/node](./block/node.md) <!-- id:4_ANAoOp -->
- [metadata](./metadata.md) <!-- id:ZuflGkc7 -->

# See also <!-- id:vn-tY5jr -->

- [Documents](./protocol/documents.md): Changes, Refs, versions, the CRDT rules. <!-- id:uCAyu2iB -->
- [Blocks](./protocol/blocks.md): the content tree. <!-- id:hhd_L8x- -->
- [metadata](./metadata.md): every metadata key. <!-- id:PJbpQSRL -->
- [Resource](./rpc/resource.md): the API request that returns a document. <!-- id:r36w2Nqp -->
