---
name: Reference Schema
summary: "The variant for a reference, which is a bare include or, when it carries refinements, an extension."
schemaDefinition: ipfs://bafyreia5b773b75qoqhrey3snq26ioz4wwmtlixtasnlkf6npjeurmeoae
---
**Include**: a `type` that names another schema by its [URL](../hm-url.md) and nothing else: `{ "type": "hm://…" }`. The node becomes exactly that schema. Adding any other key, such as `properties`, `values`, `items`, `target` or a leaf constraint, makes the node refine the schema it names instead. That is an [extension](./extension.md). [References and naming](./references.md) covers includes, links and extensions. <!-- id:NgjaircK -->

This document describes the **schema/include-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:HXN4g1ct -->

# Shape <!-- id:D5qXO3Lw -->

A **closed struct** with these fields: <!-- id:tVGElzcp -->
  - `type` _(required)_: `string` (the named schema's `hm://` or `ipfs://` URL) <!-- id:D463dhQz -->
  - `properties`: map ⟨ \* : [property](./property.md) ⟩ <!-- id:oQTdp-P8 -->
  - `values`: [schema](../schema.md) <!-- id:MVaaagll -->
  - `items`: [schema](../schema.md) <!-- id:lNTdBWuJ -->
  - `name`: `string` <!-- id:ZtRPGk76 -->
  - `description`: `string` <!-- id:SxgAQy9f -->
  - `params`: map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:djqskOkg -->
  - `args`: map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:aNFczhjo -->

# Depends on <!-- id:jXS_PwWJ -->

- [schema](../schema.md) <!-- id:ztCcR1XB -->

# See also

- [References and naming](./references.md): include, typed link and extension, and why references are names.
- [Extension](./extension.md): an include that also carries refinements.
- [Link schema](./link-schema.md): a pointer to a separate block, where an include embeds a shape.
- [`hm://` URL](../hm-url.md): how a reference names its schema.
- [Variant](./variant.md): the members of the meta-schema union.
