---
name: "RPC: InteractionSummary"
summary: "Returns a document’s aggregate citation, comment, change, child, and author counts with per-block breakdowns, given its id."
schemaDefinition: ipfs://bafyreidvcyspkzgvc3ceo43cukt7xtjfk7pjkgrkmxtsbn3joytya2uuqu
---
Aggregates interaction counts for a document, per block included. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:o5tltrJQ -->

This page describes the **rpc/interaction-summary** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:1AAby3IV -->

# Shape <!-- id:_jdaQjrs -->

A **closed struct** with these fields: <!-- id:C6ObWmqI -->
  - `key` _(required)_ — `"InteractionSummary"` <!-- id:jeZVsYXW -->
  - `input` _(required)_ — map { 1 fields } <!-- id:8lSMzs7Y -->
  - `output` _(required)_ — [rpc/type/interaction-summary](./type/interaction-summary.md) <!-- id:atPqOBD3 -->

# Depends on <!-- id:UaUlHKko -->

- [rpc/type/id](./type/id.md) <!-- id:IvcbCWto -->
- [rpc/type/interaction-summary](./type/interaction-summary.md) <!-- id:EIwlmCUh -->
