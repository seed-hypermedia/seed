---
name: Block
summary: "The open wire block: id and type plus text, link, annotations and any attributes, so a document with a block type you do not know still parses."
schemaDefinition: ipfs://bafyreib6nls3poisfp73rbwvcey7o7ybef5w5rboq5yfsus4xqxksks26i
---
The open block: the common fields (id, type, text, link, annotations, attributes) plus arbitrary extra fields of any type, requiring only id and type. This is the forward-compatible wire type Change ops and comment bodies reference — a block type this client has no schema for (a future or third-party type) is still a valid Block, so a document is never rejected over an unrecognized block. Every concrete block is a subtype; the strict recognized set is block/core. To ADD a block type, extend block/base and union it with the core (see example/poll-block / example/app-block). <!-- id:oDU4AtVK -->

This is the shape a block has inside a signed [Change](./change.md) (in a [ReplaceBlock](./change/op/replace-block.md) op) and inside a [comment](./comment.md) body. The five named keys are reserved; on the wire every attribute sits beside them at the top level of the map, while the Seed API and the SDK nest attributes under `attributes`. `revision` is filled in by the daemon when it serves a document: the CID of the last Change that replaced the block. The full model, including annotations, layouts and every built-in type, is on [Blocks](./protocol/blocks.md).

# Shape <!-- id:QiFjidUz -->

A map with these fields: <!-- id:fsTkb0Vo -->
  - `id` _(required)_ — [string](./string.md) <!-- id:JojT7-nZ -->
  - `revision` — [string](./string.md) <!-- id:lffsHj-T -->
  - `type` _(required)_ — [string](./string.md) <!-- id:cLTKblZl -->
  - `text` — [string](./string.md) <!-- id:Vp36I-vY -->
  - `link` — [string](./string.md) <!-- id:C8thhIEg -->
  - `annotations` — list of [block/annotation](./block/annotation.md) <!-- id:9JbkXwGl -->
  - `attributes` — map { 0 fields } <!-- id:wLVIaOrw -->

# Depends on <!-- id:EltAo080 -->

- [block/annotation](./block/annotation.md) <!-- id:g8o6nDyl -->
- [any](./any.md) <!-- id:ehYTDbOa -->
- [string](./string.md) <!-- id:xj1lJl3u -->
