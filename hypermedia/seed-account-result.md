---
name: Account result
summary: "The result of resolving an account: its metadata payload, or an explicit not-found. A derived read model computed by the Seed daemon/API for clients — not a sig"
schemaDefinition: ipfs://bafyreiczsgxuzyjwo6b4etpieeego6roqeiyhegi7egrijt5qegek6nuvi
---
The result of resolving an account: its metadata payload, or an explicit not-found. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:cQGLYho_ -->

This document describes the **seed-account-result** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ZMdfA4H5 -->

# Shape <!-- id:GzEze6Bq -->

A **union** — a value matches one of these variants: <!-- id:HZf6WBQs -->
  - map { 4 fields } <!-- id:f267j-6y -->
  - map { 2 fields } <!-- id:RRWidmry -->

# Depends on <!-- id:H_xarqfm -->

- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:ht4dyEW_ -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:dq0xPHDe -->
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:aTp6vL1V -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:BvamZwgP -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:-A7na0uO -->
