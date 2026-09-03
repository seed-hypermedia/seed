---
name: "RPC: ListEvents"
summary: "Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fi"
schemaDefinition: ipfs://bafyreieiotkkhbzoamsloiunryvtup2nz54gxf7hu7x2fpapeizdzj4ug4
---
Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:8NB6bWqQ -->

This document describes the **seed-rpc-list-events** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:CxLVzOd5 -->

# Shape <!-- id:kghUGbcO -->

A **closed struct** with these fields: <!-- id:1xYbf7OV -->
  - `key` _(required)_ — `string` enum: `ListEvents` <!-- id:FW4audj7 -->
  - `input` _(required)_ — map { 8 fields } <!-- id:OLNbt9vw -->
  - `output` _(required)_ — map { 2 fields } <!-- id:MV2CZkha -->

# Depends on <!-- id:y34ksrW0 -->

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:SyPfcrg3 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:VrLbVG_X -->
- [seed-activity-event](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-activity-event) <!-- id:K7mTe_LT -->
