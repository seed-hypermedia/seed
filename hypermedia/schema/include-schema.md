---
name: Reference Schema
summary: "The variant for a reference: a bare include, or an extension when it carries refinements."
schemaDefinition: ipfs://bafyreia5b773b75qoqhrey3snq26ioz4wwmtlixtasnlkf6npjeurmeoae
---
**Include**: a `type` that names another schema and nothing else: `{ "type": "hm://…" }`. Becomes exactly that schema. Add any other key — `properties`, `values`, `items`, `target`, a leaf constraint — and the node refines what it names instead: an [extension](./extension.md). ([references](./references.md)) <!-- id:NgjaircK -->

This document describes the **schema/include-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HXN4g1ct -->

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
