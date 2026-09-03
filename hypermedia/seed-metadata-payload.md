---
name: Metadata payload
summary: A resource id with its resolved metadata (null when the document has none). A derived read model computed by the Seed daemon/API for clients — not a signed netw
schemaDefinition: ipfs://bafyreidgc6lt4s5d2gw24q5kjsrdc5b5o6bq7nux7dyqegg3cgtbu7pan4
---
A resource id with its resolved metadata (null when the document has none). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:Y5u7CGw2 -->

This document describes the **seed-metadata-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:uXMpvOl- -->

# Shape <!-- id:XIHou5Ec -->
A **closed struct** with these fields: <!-- id:0j_x3TEg -->
  - `id` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:mHdVfkvN -->
  - `metadata` _(required)_ — one of [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:l5DeUFH2 -->
  - `hasSite` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:ElbUiqOU -->

# Depends on <!-- id:jWMfRp8f -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:YHNL_4BR -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:KXwYZO0v -->
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:6NloaXgX -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:L9kGhYH8 -->