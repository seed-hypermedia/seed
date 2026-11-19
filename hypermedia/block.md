---
name: Block
summary: "The open wire block: id and type plus text, link, annotations and any attributes, so a document with a block type you do not know still parses."
---
A **block** is one piece of a [document](./protocol/documents.md), such as a paragraph, a heading or an image. [Blocks](./protocol/blocks.md) explains the idea. This page defines the open block: it must have an `id` and a `type`, and it may have anything else. So a document with a block type your software does not know still loads. <!-- id:oDU4AtVK -->

The common fields are id, type, text, link, annotations and attributes. Extra fields of any type are allowed. [Change](./change.md) operations and [comment](./comment.md) bodies use this type. A block type that a client has no schema for is still a valid block, so no document is rejected because of an unknown block. Every concrete block is a subtype. The strict set of known types is [block/core](./block/core.md). To add a block type, extend [block/base](./block/base.md) and union it with the core, as [example/poll-block](./example/poll-block.md) and [example/app-block](./example/app-block.md) do.

A block has this shape inside a signed Change, in a [ReplaceBlock](./change/op/replace-block.md) operation, and inside the body of a [comment](./protocol/comments.md). The five named keys are reserved. On the wire, every attribute sits beside them at the top level of the map. The [Seed API](./build/web-api.md) and the [SDK](./build/sdk.md) nest attributes under `attributes`. A block's attributes are its own. They are separate from the document's attributes, its [metadata](./metadata.md). The [daemon](./software/daemon.md) fills in `revision` when it serves a document: the [CID](./cid.md) of the last Change that replaced the block. [Blocks](./protocol/blocks.md) has the full model, with [annotations](./block/annotation.md), layouts and every built-in type. <!-- id:ahxyyI1X -->

# See also <!-- id:ylxUc1v0 -->

- [Blocks](./protocol/blocks.md): the block model and every built-in type. <!-- id:F1X5T8KH -->
- [block/core](./block/core.md): the built-in block types. <!-- id:Zq593FAU -->
- [block/base](./block/base.md): the base to extend for a new type. <!-- id:PPf9f7iM -->
- [block/node](./block/node.md): a block with its children. <!-- id:rXgTp-k9 -->
- [block/annotation](./block/annotation.md): inline formatting. <!-- id:AXeXs2am -->
- [ReplaceBlock](./change/op/replace-block.md): the op that writes a block. <!-- id:knP1vDLw -->

# Block types and their parts <!-- id:GbRpPFth attrs:{"childrenType":"Grid","columnCount":3} -->

<./block/annotation.md> <!-- id:6KFOhUEF type:Embed attrs:{"view":"Card"} -->

<./block/base.md> <!-- id:TiohkpPO type:Embed attrs:{"view":"Card"} -->

<./block/button-alignment.md> <!-- id:fXnt6em7 type:Embed attrs:{"view":"Card"} -->

<./block/button.md> <!-- id:4LSnLYFA type:Embed attrs:{"view":"Card"} -->

<./block/children-type.md> <!-- id:i5jyYusH type:Embed attrs:{"view":"Card"} -->

<./block/code.md> <!-- id:AKw3JqX9 type:Embed attrs:{"view":"Card"} -->

<./block/comment.md> <!-- id:ImjKKEIY type:Embed attrs:{"view":"Card"} -->

<./block/core.md> <!-- id:ALW28rr0 type:Embed attrs:{"view":"Card"} -->

<./block/embed-view.md> <!-- id:KyrERPbK type:Embed attrs:{"view":"Card"} -->

<./block/embed.md> <!-- id:EJ3WrJA1 type:Embed attrs:{"view":"Card"} -->

<./block/file.md> <!-- id:RjpjGID3 type:Embed attrs:{"view":"Card"} -->

<./block/heading.md> <!-- id:CoBvjELN type:Embed attrs:{"view":"Card"} -->

<./block/image.md> <!-- id:nJGHU3fO type:Embed attrs:{"view":"Card"} -->

<./block/math.md> <!-- id:TunjPmCo type:Embed attrs:{"view":"Card"} -->

<./block/node.md> <!-- id:eudEQr2D type:Embed attrs:{"view":"Card"} -->

<./block/nostr.md> <!-- id:pe4Cl5Jv type:Embed attrs:{"view":"Card"} -->

<./block/paragraph.md> <!-- id:dqKDGqpK type:Embed attrs:{"view":"Card"} -->

<./block/query.md> <!-- id:b0abUk3m type:Embed attrs:{"view":"Card"} -->

<./block/table-column.md> <!-- id:R5AQftvn type:Embed attrs:{"view":"Card"} -->

<./block/table-row.md> <!-- id:sPvpGiUf type:Embed attrs:{"view":"Card"} -->

<./block/table.md> <!-- id:2tDeyJvg type:Embed attrs:{"view":"Card"} -->

<./block/text-alignment.md> <!-- id:669tvA4F type:Embed attrs:{"view":"Card"} -->

<./block/video.md> <!-- id:o9fTQvl3 type:Embed attrs:{"view":"Card"} -->

<./block/web-embed.md> <!-- id:UT8DA1w8 type:Embed attrs:{"view":"Card"} -->
