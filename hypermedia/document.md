---
name: Document
summary: The read model of a Hypermedia document, the metadata and block tree that result from replaying its Changes, and the base every typed document's attributes are folded into.
---
A **document** is what you get when you read a Hypermedia address: its attributes and its content. The attributes are called [metadata](./metadata.md). The content is a tree of [blocks](./protocol/blocks.md). This page describes that result. [Documents](./protocol/documents.md) explains how it is built. <!-- id:qIPS3d4t -->

This page defines the **document** value. The [daemon](./software/daemon.md) computes it from a document's Changes and hands it to readers. No signed [blob](./protocol/blobs.md) holds it. The formal schema is attached to this document as the `schemaDefinition` key of its metadata. So the app can show the schema and check values of this shape. <!-- id:Kc-oFVmL -->

On the wire, a document is a graph of [Change](./change.md) blobs, plus a [Ref](./ref.md) that names its heads. No blob's bytes are "the document". The API, the [CLI](./build/cli.md) and the [SDK](./build/sdk.md) return this value. `metadata` is the merged result of every [SetAttributes](./change/op/set-attributes.md) operation. `content` is the tree of [block nodes](./block/node.md), built from the block moves and the latest state of each block. The API's full result adds what the schema leaves out: the [account](./protocol/identity.md) and path, the version string, the authors, timestamps, the genesis, and the [detached blocks](./protocol/blocks.md). <!-- id:OBypN7it -->

Three metadata keys connect a document to a schema, and this shape stays the same. `attributesSchema` names the [struct](./struct.md) this document's metadata must match. `childAttributesSchema` names the struct its children must match. `schemaDefinition` says this document defines a schema for others to use. A typed document does not extend this type. It names its schema through `attributesSchema`, or takes one from its parent's `childAttributesSchema`. It is still exactly this value, with the base metadata keys beside the type's own fields. [Typed documents](./schema/typed-documents.md) has the rules. [Documents](./protocol/documents.md) has the history model behind the value. <!-- id:7PTJUigg -->

# See also <!-- id:vn-tY5jr -->

- [Documents](./protocol/documents.md): Changes, Refs, versions, the CRDT rules. <!-- id:uCAyu2iB -->
- [Blocks](./protocol/blocks.md): the content tree. <!-- id:hhd_L8x- -->
- [metadata](./metadata.md): every metadata key. <!-- id:PJbpQSRL -->
- [Seed API](./build/web-api.md): the `Resource` request returns a document. <!-- id:r36w2Nqp -->
- [Typed documents](./schema/typed-documents.md): binding a document to a schema. <!-- id:dHvF1nT1 -->
- [change](./change.md) and [ref](./ref.md): the blobs a document is built from. <!-- id:pGSVAs5n -->
