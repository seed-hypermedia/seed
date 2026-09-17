---
name: Block (Base)
summary: "The three fields every concrete block type shares: the required id and type, and the daemon-filled revision."
schemaDefinition: ipfs://bafyreidwdd7tojybh5gqkzglruektctlgvckgu3wvyru2uu7au7pzqgz6y
---
**Block (Base)** holds the three fields every concrete [block](../block.md) type shares, and every concrete type extends it. `id` is the block's permanent identity inside its document. `type` names the block type. `revision` is output only: the CID of the last [Change](../change.md) that modified the block. A new block type is a struct that extends this base and adds its own `text`, `link`, `annotations` and `attributes`. See [block/core](./core.md) for the built-in union and [Blocks](../protocol/blocks.md) for the model. <!-- id:u-pDGjJ_ -->

# Shape <!-- id:QptDZ4s_ -->

A **closed struct** with these fields: <!-- id:oaPUbuet -->
  - `id` _(required)_: [string](../string.md) <!-- id:HJepUEoZ -->
  - `revision`: [string](../string.md) <!-- id:wOo3etTY -->
  - `type` _(required)_: [string](../string.md) <!-- id:Lsihdw38 -->

# Depends on <!-- id:WX3NBBPn -->

- [string](../string.md) <!-- id:3isavs_Q -->

# See also <!-- id:t38T51PA -->

- [block/core](./core.md): the built-in types that extend this base. <!-- id:4dHdhuZy -->
- [block](../block.md): the open block. <!-- id:_oek80Aw -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:AjC29_Xq -->
- [Extension](../schema/extension.md): how a schema extends another. <!-- id:2JdsBW2L -->
- [Example: poll block](../example/poll-block.md): a custom block type. <!-- id:Uh4eoxlw -->
