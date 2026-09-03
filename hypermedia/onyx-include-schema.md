---
name: Reference schema
summary: "The variant for a reference: a bare include, or an extension when it carries refinements."
schemaDefinition: ipfs://bafyreiao4ihabkfnwixroz6qf3euzrb2dj3z35ivxh2rwzis6k5d43itcq
---
This document describes the **onyx-include-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HXN4g1ct -->

# Shape <!-- id:D5qXO3Lw -->

A **closed struct** with these fields: <!-- id:tVGElzcp -->
  - `ref` _(required)_ — `string` <!-- id:D463dhQz -->
  - `properties` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:oQTdp-P8 -->
  - `required` — list of `string` <!-- id:AZCwRyR0 -->
  - `values` — [schema](./onyx-schema.md) <!-- id:MVaaagll -->
  - `items` — [schema](./onyx-schema.md) <!-- id:lNTdBWuJ -->
  - `enum` — list of any <!-- id:zwdZVco6 -->
  - `name` — `string` <!-- id:ZtRPGk76 -->
  - `description` — `string` <!-- id:SxgAQy9f -->
  - `params` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:djqskOkg -->
  - `args` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:aNFczhjo -->

# Depends on <!-- id:jXS_PwWJ -->

- [schema](./onyx-schema.md) <!-- id:ztCcR1XB -->
