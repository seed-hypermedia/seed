---
name: Query block payload
summary: "Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/A"
schemaDefinition: ipfs://bafyreib3rfq747lruyqbb6zurdk5dom5watblahbgzfiqwutjwzvfuxtuq
---
Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:VzSZH5xA -->

This document describes the **seed-query-block-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:OsEQqtxV -->

# Shape <!-- id:a4jQ1u0u -->

A **closed struct** with these fields: <!-- id:DyS_qKTz -->
  - `queryTargetName` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:lpgzgCDx -->
  - `in` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:PaNXccq8 -->
  - `results` _(required)_ — list of [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info) <!-- id:pqVQymXu -->
  - `mode` — `string` enum: `Children` `AllDescendants` <!-- id:HKi67-Wj -->
  - `interactionSummaries` _(required)_ — map ⟨ \* : [seed-query-block-item-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-block-item-summary) ⟩ <!-- id:EqpWvaWn -->
  - `accountsMetadata` _(required)_ — [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata) <!-- id:UpOdUnhj -->

# Depends on <!-- id:ooVpqrDK -->

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:z5cuCUEY -->
- [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata) <!-- id:J1qY7Tl5 -->
- [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info) <!-- id:IBffstpK -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:VjUau-KS -->
- [seed-query-block-item-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-block-item-summary) <!-- id:3DKOCjfE -->
