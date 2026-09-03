---
name: Comment list
summary: "A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network "
schemaDefinition: ipfs://bafyreifcajk7p24t6engwo4sysjhvaxrwrgrmzh7vrub3ql6ro6dilqvmu
---
A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:YsLbrH3B -->

This document describes the **seed-comment-list** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NORHzsPw -->

# Shape <!-- id:PppnBW7I -->
A **closed struct** with these fields: <!-- id:KZctBNHM -->
  - `comments` _(required)_ — list of [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:kVFQBkzL -->
  - `authors` _(required)_ — map ⟨ \* : [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload) ⟩ <!-- id:ZBgvETJb -->

# Depends on <!-- id:Xlb8F54n -->
- [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:uEtChrVR -->
- [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload) <!-- id:Dt3ONyxv -->