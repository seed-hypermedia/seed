---
name: "RPC: InteractionSummary"
summary: "Aggregates interaction counts for a document, per block included. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fiel"
schemaDefinition: ipfs://bafyreifnsbv6z2myfytzlbjp4exz6fattor6vclfqztfaxmrbpgmna7yre
---
Aggregates interaction counts for a document, per block included. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:o5tltrJQ -->

This document describes the **seed-rpc-interaction-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:1AAby3IV -->