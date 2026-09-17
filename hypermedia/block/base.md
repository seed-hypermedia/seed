---
name: Block (Base)
summary: "The three fields every concrete block type shares: the required id and type, and the daemon-filled revision."
schemaDefinition: ipfs://bafyreidwdd7tojybh5gqkzglruektctlgvckgu3wvyru2uu7au7pzqgz6y
---
Every concrete block type extends this struct: `id` is the block's permanent identity inside its document, `type` names the block type, and `revision` is output only, the CID of the last Change that modified the block. A new block type is a struct that extends this base and adds its own `text`, `link`, `annotations` and `attributes`; see [block/core](./core.md) for the built-in union and [Blocks](../protocol/blocks.md) for the model.

# Shape <!-- id:QptDZ4s_ -->

A **closed struct** with these fields: <!-- id:oaPUbuet -->
  - `id` _(required)_: [string](../string.md) <!-- id:HJepUEoZ -->
  - `revision`: [string](../string.md) <!-- id:wOo3etTY -->
  - `type` _(required)_: [string](../string.md) <!-- id:Lsihdw38 -->

# Depends on <!-- id:WX3NBBPn -->

- [string](../string.md) <!-- id:3isavs_Q -->
