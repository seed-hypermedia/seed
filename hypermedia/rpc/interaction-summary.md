---
name: "RPC: InteractionSummary"
summary: "Aggregates interaction counts for a document, per block included. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fiel"
schemaDefinition: ipfs://bafyreiajaaf7iasjf3okmrmvrseiksglnnkc67qprvtywei2szxku2g474
---
Aggregates interaction counts for a document, per block included. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:o5tltrJQ -->

This document describes the **rpc/interaction-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:1AAby3IV -->

# Shape <!-- id:_jdaQjrs -->

A **closed struct** with these fields: <!-- id:C6ObWmqI -->
  - `key` _(required)_ — `"InteractionSummary"` <!-- id:jeZVsYXW -->
  - `input` _(required)_ — map { 1 fields } <!-- id:8lSMzs7Y -->
  - `output` _(required)_ — [rpc/type/interaction-summary](./type/interaction-summary.md) <!-- id:atPqOBD3 -->

# Depends on <!-- id:UaUlHKko -->

- [rpc/type/id](./type/id.md) <!-- id:IvcbCWto -->
- [rpc/type/interaction-summary](./type/interaction-summary.md) <!-- id:EIwlmCUh -->
