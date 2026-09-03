---
name: "Resource: tombstone"
summary: A resource that was deleted (a tombstone ref). A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreidzzgpyb2d4cid2wphm2gewlphelssktnjkmi34jqmp7adloro5fi
---
This document describes the **seed-resource-tombstone** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:J9aXyASx -->

# Shape <!-- id:_bPH9V6J -->
A **closed struct** with these fields: <!-- id:iq6WzySf -->
  - `type` _(required)_ — `string` enum: `tombstone` <!-- id:r8b5CNgx -->
  - `id` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:ZERYE6t9 -->

# Depends on <!-- id:NkOEAKQC -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:iGUIKF_k -->