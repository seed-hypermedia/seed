---
name: "RPC: Search"
summary: "Searches the network for documents, contacts, and comments. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field type"
schemaDefinition: ipfs://bafyreihd5kpjaj423asuxiqrqz3ejqimwgal4753kme4bwasm2m56hjjvi
---
Searches the network for documents, contacts, and comments. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:6M7UDKGx -->

This document describes the **seed-rpc-search** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Ua8QFVyl -->