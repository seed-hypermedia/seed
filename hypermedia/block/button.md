---
name: Button Block
summary: "A call-to-action button: a label, a required link and a horizontal alignment."
schemaDefinition: ipfs://bafyreifqzjgn7p35ejndllmcjepvtkg56pdovu5sucx547l5ve6yepdaee
---
A button: `text` is the label and `link` (required) is where it goes, an `hm://` or web URL. Attributes: `name` (an alternative label), `alignment` (a [button alignment](./button-alignment.md): `flex-start`, `center` or `flex-end`), and the parent-layout pair.

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
