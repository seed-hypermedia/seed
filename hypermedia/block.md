---
name: Block
summary: "The open wire block: id and type plus text, link, annotations and any attributes, so a document with a block type you do not know still parses."
schemaDefinition: ipfs://bafyreib6nls3poisfp73rbwvcey7o7ybef5w5rboq5yfsus4xqxksks26i
---
A **block** is one unit of document content, such as a paragraph, a heading or an image; see [Blocks](./protocol/blocks.md). This page defines the open block: the common fields (id, type, text, link, annotations, attributes) plus any extra fields of any type, with only id and type required. It is the forward-compatible wire type that [Change](./change.md) ops and [comment](./comment.md) bodies reference. A block type this client has no schema for, such as a future or third-party type, is still a valid Block, so a document is never rejected over an unrecognized block. Every concrete block is a subtype. The strict set of recognized types is [block/core](./block/core.md). To add a block type, extend [block/base](./block/base.md) and union it with the core, as [example/poll-block](./example/poll-block.md) and [example/app-block](./example/app-block.md) do. <!-- id:oDU4AtVK -->

This is the shape a block has inside a signed Change, in a [ReplaceBlock](./change/op/replace-block.md) op, and inside a comment body. The five named keys are reserved. On the wire every attribute sits beside them at the top level of the map, while the [Seed API](./build/web-api.md) and the [SDK](./build/sdk.md) nest attributes under `attributes`. The daemon fills in `revision` when it serves a document: the CID of the last Change that replaced the block. [Blocks](./protocol/blocks.md) has the full model, including [annotations](./block/annotation.md), layouts and every built-in type.

# Shape <!-- id:QiFjidUz -->

A map with these fields: <!-- id:fsTkb0Vo -->
  - `id` _(required)_: [string](./string.md) <!-- id:JojT7-nZ -->
  - `revision`: [string](./string.md) <!-- id:lffsHj-T -->
  - `type` _(required)_: [string](./string.md) <!-- id:cLTKblZl -->
  - `text`: [string](./string.md) <!-- id:Vp36I-vY -->
  - `link`: [string](./string.md) <!-- id:C8thhIEg -->
  - `annotations`: list of [block/annotation](./block/annotation.md) <!-- id:9JbkXwGl -->
  - `attributes`: map { 0 fields } <!-- id:wLVIaOrw -->

# Depends on <!-- id:EltAo080 -->

- [block/annotation](./block/annotation.md) <!-- id:g8o6nDyl -->
- [any](./any.md) <!-- id:ehYTDbOa -->
- [string](./string.md) <!-- id:xj1lJl3u -->

# See also

- [Blocks](./protocol/blocks.md): the block model and every built-in type.
- [block/core](./block/core.md): the built-in block types.
- [block/base](./block/base.md): the base to extend for a new type.
- [block/node](./block/node.md): a block with its children.
- [block/annotation](./block/annotation.md): inline formatting.
- [ReplaceBlock](./change/op/replace-block.md): the op that writes a block.
