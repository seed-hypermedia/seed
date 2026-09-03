---
name: Citation
summary: "One mention of a target resource from elsewhere on the network: the citing source (a document 'd' or a comment 'c'), whether it pinned the exact version, and th"
schemaDefinition: ipfs://bafyreicwx2vhujxwgcmn4mel3vxxi56figca2t3tccjppabdmncejpiadi
---
One mention of a target resource from elsewhere on the network: the citing source (a document 'd' or a comment 'c'), whether it pinned the exact version, and the fragment it points at. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:vp-ojCpz -->

This document describes the **seed-citation** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:MOh8ryRo -->

# Shape <!-- id:rbyri4dZ -->
A **closed struct** with these fields: <!-- id:VmqoRbRO -->
  - `source` _(required)_ — one of map { 4 fields } | map { 4 fields } <!-- id:MdIAs04J -->
  - `isExactVersion` _(required)_ — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:UJZmjhTF -->
  - `targetFragment` _(required)_ — one of [seed-parsed-fragment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-parsed-fragment) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:wzdqS34J -->
  - `targetId` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:StfBx79G -->

# Depends on <!-- id:DfdIjFgi -->
- [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:qmlMMX_K -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:bMN0_lDm -->
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:y97zthBM -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Ecgkvu07 -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:ZVKjgJT0 -->
- [seed-parsed-fragment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-parsed-fragment) <!-- id:sJ6YEHCt -->