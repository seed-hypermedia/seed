---
name: Button Block
summary: "A call-to-action button: a label, a required link and a horizontal alignment."
schemaDefinition: ipfs://bafyreifqzjgn7p35ejndllmcjepvtkg56pdovu5sucx547l5ve6yepdaee
---
A **button block** is a call-to-action button. `text` is the label, and `link` (required) is where it goes: an `hm://` or web URL, see [URLs](../protocol/urls.md). Attributes: `name` (an alternative label), `alignment` (a [button alignment](./button-alignment.md): `flex-start`, `center` or `flex-end`), and the parent-layout pair `childrenType` and `columnCount`. <!-- id:JBQN_b6r -->

# Shape <!-- id:xGD5dY-c -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:CY2yoTm1 -->
  - `type`: `"Button"` <!-- id:6Nvnbcfu -->
  - `text`: [string](../string.md) <!-- id:1F063pXv -->
  - `link` _(required)_: [string](../string.md) <!-- id:EESTSjCi -->
  - `attributes`: map { 4 fields } <!-- id:UxIYwOeL -->

# Depends on <!-- id:glOGR_U7 -->

- [block/base](./base.md) <!-- id:_0hbglqH -->
- [block/button-alignment](./button-alignment.md) <!-- id:W3GAkILw -->
- [block/children-type](./children-type.md) <!-- id:ViB7NkN7 -->
- [any](../any.md) <!-- id:kQPzV4Nj -->
- [float](../float.md) <!-- id:rjjWap8S -->
- [string](../string.md) <!-- id:dcAn-Ks- -->

# See also <!-- id:D0909KYI -->

- [block/button-alignment](./button-alignment.md): where the button sits. <!-- id:vTGd7N5i -->
- [block/embed](./embed.md): show a linked document in place. <!-- id:8ExLW19I -->
- [block/core](./core.md): all built-in block types. <!-- id:bKIQAvJw -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:p7M2sHWe -->
