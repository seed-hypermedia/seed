---
name: "RPC: ListCitations"
summary: "Lists raw citations of a target resource. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `"
schemaDefinition: ipfs://bafyreiduaezyptqyu63fk2eealjlgff6os6myblbloexpcnrfyckbsjboy
---
Lists raw citations of a target resource. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:EWDwlcgM -->

This document describes the **seed-rpc-list-citations** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:4clN1Gbd -->

# Shape <!-- id:z2qy10O8 -->
A **closed struct** with these fields: <!-- id:DCfHjHME -->
  - `key` _(required)_ — `string` enum: `ListCitations` <!-- id:kLPa7FFC -->
  - `input` _(required)_ — map { 1 fields } <!-- id:764R8Zt5 -->
  - `output` _(required)_ — map { 1 fields } <!-- id:q3KgSdY9 -->

# Depends on <!-- id:Wk6DpqCs -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:iS-6L-Uf -->
- [seed-raw-citation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-raw-citation) <!-- id:Umt7r3Gz -->