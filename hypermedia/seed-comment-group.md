---
name: Comment group
summary: A thread of comments grouped for display, with a count of elided replies. A derived read model computed by the Seed daemon/API for clients — not a signed networ
schemaDefinition: ipfs://bafyreia3j5fm65jbuucnalndutlghm7niq3c6dkhb5rn3utkgyite62cem
---
A thread of comments grouped for display, with a count of elided replies. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:kfaho3GA -->

This document describes the **seed-comment-group** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XEbgwnCN -->

# Shape <!-- id:bn9hhdhT -->

A **closed struct** with these fields: <!-- id:hQ_A0BRE -->
  - `comments` _(required)_ — list of [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:6j0dIlAA -->
  - `moreCommentsCount` _(required)_ — `integer` <!-- id:YX7_v3Cs -->
  - `id` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:LESTYzIE -->
  - `type` _(required)_ — `string` enum: `commentGroup` <!-- id:8G00dDGM -->

# Depends on <!-- id:zRpGsTRj -->

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Cmnm7JiI -->
- [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:fg2iMFOh -->
