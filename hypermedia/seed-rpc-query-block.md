---
name: "RPC: QueryBlock"
summary: "Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input`"
schemaDefinition: ipfs://bafyreicjc4wwp6x45pylwfxrvdv33fbaw5y6yoohnfq6cqij2wmnu6qai4
---
Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:9vWOoz-M -->

This document describes the **seed-rpc-query-block** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:0Yk-OOw5 -->