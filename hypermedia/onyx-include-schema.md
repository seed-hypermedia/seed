---
name: Reference schema
summary: "The variant for a reference: a bare include, or an extension when it carries refinements."
schemaDefinition: ipfs://bafyreibjrfvwh2vjaesqikrscqt5xwhcskgik3w7sufaj5o2pc22y2ahpi
---
This document describes the **onyx-include-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HXN4g1ct -->

# Shape <!-- id:D5qXO3Lw -->

A **closed struct** with these fields: <!-- id:tVGElzcp -->
  - `ref` _(required)_ — `string` <!-- id:D463dhQz -->
  - `properties` — map ⟨ \* : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩ <!-- id:oQTdp-P8 -->
  - `required` — list of `string` <!-- id:AZCwRyR0 -->
  - `values` — [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) <!-- id:MVaaagll -->
  - `items` — [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) <!-- id:lNTdBWuJ -->
  - `enum` — list of any <!-- id:zwdZVco6 -->
  - `name` — `string` <!-- id:ZtRPGk76 -->
  - `description` — `string` <!-- id:SxgAQy9f -->
  - `params` — map ⟨ \* : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩ <!-- id:djqskOkg -->
  - `args` — map ⟨ \* : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩ <!-- id:aNFczhjo -->

# Depends on <!-- id:jXS_PwWJ -->

- [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) <!-- id:ztCcR1XB -->
