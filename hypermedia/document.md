---
name: Document
summary: The read model of a Hypermedia document, the metadata and block tree that result from replaying its Changes, and the base every typed document's attributes are folded into.
---
The **document** type is the base Hypermedia [document](./protocol/documents.md): resolved metadata, including the schema-binding fields `attributesSchema`, `childAttributesSchema` and `schemaDefinition`, plus the content [block](./protocol/blocks.md) tree. A typed document does not extend this type. It names an attributes schema, a struct describing its metadata fields, through `attributesSchema`, or inherits one from its parent's `childAttributesSchema`. <!-- id:qIPS3d4t -->

This page defines the **document** value: the resolved state that the daemon computes from a document's Changes and hands to readers. No signed network blob holds it. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show and validate values of this shape. <!-- id:Kc-oFVmL -->

On the wire, a document is a graph of [Change](./change.md) blobs and a [Ref](./ref.md) that names its heads. No blob's bytes are "the document". The API, the [CLI](./build/cli.md) and the [SDK](./build/sdk.md) return this value. `metadata` is the merged result of every [SetAttributes](./change/op/set-attributes.md) register. `content` is the tree of [block nodes](./block/node.md) built from the move tree and the per-block registers. The API's full read model adds what the schema leaves out: the account and path, the version string, the authors, timestamps, the genesis, and the detached blocks. <!-- id:OBypN7it -->

The three schema-binding metadata keys make typing work without touching this shape. `attributesSchema` names the struct this document's metadata must satisfy. `childAttributesSchema` names the struct its children must satisfy. `schemaDefinition` says this document defines a schema for others to reference. A typed document is still exactly this value, with the base metadata keys folded in beneath the type's fields. [Typed documents](./schema/typed-documents.md) has the rules, and [Documents](./protocol/documents.md) has the history model behind the value. <!-- id:7PTJUigg -->

# See also <!-- id:vn-tY5jr -->

- [Documents](./protocol/documents.md): Changes, Refs, versions, the CRDT rules. <!-- id:uCAyu2iB -->
- [Blocks](./protocol/blocks.md): the content tree. <!-- id:hhd_L8x- -->
- [metadata](./metadata.md): every metadata key. <!-- id:PJbpQSRL -->
- [Seed API](./build/web-api.md): the `Resource` request returns a document. <!-- id:r36w2Nqp -->
- [Typed documents](./schema/typed-documents.md): binding a document to a schema. <!-- id:dHvF1nT1 -->
- [change](./change.md) and [ref](./ref.md): the blobs a document is built from. <!-- id:pGSVAs5n -->
