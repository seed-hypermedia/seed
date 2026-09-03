---
name: Query result
summary: The documents a query matched, listed under the queried id. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreichylsa2l3imzm23lg3yd6gyovsudroauvdjdycz4t225djahmgdy
---
This document describes the **seed-query-result** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:02nM8--s -->

# Shape <!-- id:IU9zCBCy -->

A **closed struct** with these fields: <!-- id:EvmdoseV -->
  - `in` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:JZ6P9O4y -->
  - `results` _(required)_ — list of [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info) <!-- id:eo8ia6we -->
  - `mode` — `string` enum: `Children` `AllDescendants` <!-- id:RePHCtTX -->

# Depends on <!-- id:uRtiQkyh -->

- [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info) <!-- id:U3vw88Mz -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:l99ph1Cb -->
