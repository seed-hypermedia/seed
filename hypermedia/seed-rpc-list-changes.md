---
name: "RPC: ListChanges"
summary: "Lists a document's change history. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output`"
schemaDefinition: ipfs://bafyreicvj7fs37cbrihyib5b3nvze523ipwez4r4agiup5s6eau2vyo6sa
---
Lists a document's change history. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:ihAmEwiL -->

This document describes the **seed-rpc-list-changes** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:TM8oraL9 -->

# Shape <!-- id:i0mfuAmP -->
A **closed struct** with these fields: <!-- id:CpilCY5t -->
  - `key` _(required)_ — `string` enum: `ListChanges` <!-- id:NrggjHy1 -->
  - `input` _(required)_ — map { 1 fields } <!-- id:SM1Ak_h_ -->
  - `output` _(required)_ — map { 2 fields } <!-- id:zbAgJ_cH -->

# Depends on <!-- id:xbUuATMI -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:CR9fgC3y -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:5kkwJiCD -->
- [seed-raw-document-change](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-raw-document-change) <!-- id:3-1Dl14U -->