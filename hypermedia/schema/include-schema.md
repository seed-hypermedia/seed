---
name: Reference schema
summary: "The variant for a reference: a bare include, or an extension when it carries refinements."
schemaDefinition: ipfs://bafyreibw7dbsnebxlujejhfbu7r7gxqbazdhiqvh5nhtbw565slv5u45ue
---
**Include** — a bare reference `{ "ref": "hm://…" }` (no `type`, no refinements). Becomes exactly the referenced schema. ([references](./references.md)) <!-- id:NgjaircK -->

This document describes the **schema/include-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HXN4g1ct -->

# Shape <!-- id:D5qXO3Lw -->

A **closed struct** with these fields: <!-- id:tVGElzcp -->
  - `ref` _(required)_ — `string` <!-- id:D463dhQz -->
  - `properties` — map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:oQTdp-P8 -->
  - `required` — list of `string` <!-- id:AZCwRyR0 -->
  - `values` — [schema](../schema.md) <!-- id:MVaaagll -->
  - `items` — [schema](../schema.md) <!-- id:lNTdBWuJ -->
  - `name` — `string` <!-- id:ZtRPGk76 -->
  - `description` — `string` <!-- id:SxgAQy9f -->
  - `params` — map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:djqskOkg -->
  - `args` — map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:aNFczhjo -->

# Depends on <!-- id:jXS_PwWJ -->

- [schema](../schema.md) <!-- id:ztCcR1XB -->
