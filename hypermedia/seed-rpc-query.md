---
name: "RPC: Query"
summary: "Runs a document query (the same shape a Query block embeds). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field typ"
schemaDefinition: ipfs://bafyreihir35umrjsllqruid6dqtsyasykxrxf7ufkibjd5ogawcyeihu4m
---
Runs a document query (the same shape a Query block embeds). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:ikOICZ5G -->

This document describes the **seed-rpc-query** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ci5mADgR -->

# Shape <!-- id:iirT7bVv -->

A **closed struct** with these fields: <!-- id:BqgxY2nD -->
  - `key` _(required)_ — `string` enum: `Query` <!-- id:LqFcY9h4 -->
  - `input` _(required)_ — [hypermedia-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query) <!-- id:3CteGWBj -->
  - `output` _(required)_ — one of [seed-query-result](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-result) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:e3b637gr -->

# Depends on <!-- id:6QyI0lnv -->

- [hypermedia-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query) <!-- id:vBboMmrJ -->
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:BVB9w3KD -->
- [seed-query-result](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-result) <!-- id:_MQGXI7B -->
