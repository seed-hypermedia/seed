---
name: Reference schema
summary: "The variant for a reference: a bare include, or an extension when it carries refinements."
schemaDefinition: ipfs://bafyreiex3pp7m34lgw6zga57xheofol7n3ro37qbmrjpd55xmdp7scrdlm
---
This document describes the **hypermedia-include-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HXN4g1ct -->

# Shape <!-- id:D5qXO3Lw -->

A **closed struct** with these fields: <!-- id:tVGElzcp -->
  - `ref` _(required)_ — `string` <!-- id:D463dhQz -->
  - `properties` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:oQTdp-P8 -->
  - `required` — list of `string` <!-- id:AZCwRyR0 -->
  - `values` — [schema](./hypermedia-schema.md) <!-- id:MVaaagll -->
  - `items` — [schema](./hypermedia-schema.md) <!-- id:lNTdBWuJ -->
  - `enum` — list of any <!-- id:zwdZVco6 -->
  - `name` — `string` <!-- id:ZtRPGk76 -->
  - `description` — `string` <!-- id:SxgAQy9f -->
  - `params` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:djqskOkg -->
  - `args` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:aNFczhjo -->

# Depends on <!-- id:jXS_PwWJ -->

- [schema](./hypermedia-schema.md) <!-- id:ztCcR1XB -->
