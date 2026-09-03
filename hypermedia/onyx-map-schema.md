---
name: Map schema
summary: The variant for a map value — a closed struct (via properties) or an open map (via values).
schemaDefinition: ipfs://bafyreiacji5paepgcuzibzbnrtifnhq6u743wu7bcvcanqkl7opm7ag7be
---
This document describes the **onyx-map-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:N3w6Zkyv -->

# Shape <!-- id:DIHvEvnR -->
A **closed struct** with these fields: <!-- id:tobWRH1P -->
  - `type` _(required)_ — `string` enum: `map` <!-- id:uoqTZgf3 -->
  - `properties` — map ⟨ \* : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩ <!-- id:X3L1FJjV -->
  - `required` — list of `string` <!-- id:MK6hvmur -->
  - `values` — [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) <!-- id:orZ1de-U -->
  - `name` — `string` <!-- id:mSTdLOPL -->
  - `description` — `string` <!-- id:aWAzbwvR -->
  - `params` — map ⟨ \* : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩ <!-- id:6fKAJWXB -->

# Depends on <!-- id:VZpWi77O -->
- [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) <!-- id:0VHAY2ye -->