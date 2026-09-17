---
name: "Example: App Block (Extended Core)"
summary: "How a third party extends the block model: a strict union of Hypermedia’s core blocks plus the app’s own Poll block, rejecting block types it does not know."
---
How a third party extends the [block](../protocol/blocks.md) model. This [union](../schema/anyof.md) holds Hypermedia's [core blocks](../block/core.md) plus the app's own custom blocks, here a [poll](./poll-block.md). It is strict: it accepts core blocks and polls, and rejects block types it does not know. An app validates its documents against it. <!-- id:U9a6O76e -->

This page describes the **example/app-block** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:AqLfI1sF -->

# See also <!-- id:QR7ghAYW -->

- [poll-block](./poll-block.md): the custom block it adds. <!-- id:uRHU5dXA -->
- [myapp-change](./myapp-change.md): a Change bound to this block type. <!-- id:Hq7F_GRU -->
- [Core blocks](../block/core.md): the built-in block union. <!-- id:1oo10ITR -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:wfgpsgK4 -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:-gyLSJej -->
