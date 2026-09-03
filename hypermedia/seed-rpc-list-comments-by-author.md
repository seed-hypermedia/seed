---
name: "RPC: ListCommentsByAuthor"
summary: "Lists the comments an author has written. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `"
schemaDefinition: ipfs://bafyreic3gih5oau77w5q7zkspbhn3cptc4k7js2mv6grrmdpssbdrbgiym
---
Lists the comments an author has written. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:TNeyZeWT -->

This document describes the **seed-rpc-list-comments-by-author** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Yo-aNsvf -->

# Shape <!-- id:SmqiIOrD -->
A **closed struct** with these fields: <!-- id:LP2wLk4H -->
  - `key` _(required)_ — `string` enum: `ListCommentsByAuthor` <!-- id:6ScncCpi -->
  - `input` _(required)_ — map { 1 fields } <!-- id:NyEpluIW -->
  - `output` _(required)_ — [seed-comment-list](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-list) <!-- id:r5kRTsmu -->

# Depends on <!-- id:OKsUfq8K -->
- [seed-comment-list](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-list) <!-- id:-JnWEZdC -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:DFyGRqV- -->