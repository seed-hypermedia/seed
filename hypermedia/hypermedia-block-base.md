---
name: Block (base)
summary: "Fields shared by every concrete block type: id, optional revision, and the type discriminator. Concrete blocks extend this."
schemaDefinition: ipfs://bafyreifcarvtruhze6orq5jgiefhwujrv42hrmzvyshhaom7kix624rkwy
---
This document describes the **hypermedia-block-base** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ibCqRoF1 -->

# Shape <!-- id:QptDZ4s_ -->

A **closed struct** with these fields: <!-- id:oaPUbuet -->
  - `id` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:HJepUEoZ -->
  - `revision` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:wOo3etTY -->
  - `type` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Lsihdw38 -->

# Depends on <!-- id:WX3NBBPn -->

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:3isavs_Q -->
