---
name: "RPC: Search"
summary: "Searches the network for documents, contacts, and comments. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field type"
schemaDefinition: ipfs://bafyreihd5kpjaj423asuxiqrqz3ejqimwgal4753kme4bwasm2m56hjjvi
---
Searches the network for documents, contacts, and comments. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:6M7UDKGx -->

This document describes the **seed-rpc-search** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Ua8QFVyl -->

# Shape <!-- id:rNtJKIpN -->

A **closed struct** with these fields: <!-- id:xZHVDSnU -->
  - `key` _(required)_ — `string` enum: `Search` <!-- id:jyBd_Pa7 -->
  - `input` _(required)_ — map { 11 fields } <!-- id:ngg4oBL5 -->
  - `output` _(required)_ — [seed-search-results](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-search-results) <!-- id:OlDlHyNJ -->

# Depends on <!-- id:OUtj28Fz -->

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:XSL1ytom -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:T4EMUh_q -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:pea6QrJ4 -->
- [seed-search-results](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-search-results) <!-- id:oDACMPrv -->
