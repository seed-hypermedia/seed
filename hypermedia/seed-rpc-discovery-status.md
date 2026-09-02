---
name: "RPC: DiscoveryStatus"
summary: "Reports the state of a background discovery task. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you"
schemaDefinition: ipfs://bafyreid2glr7b7hgfrlpxvjp2r2incg6b4xgudzlqg5sp2d6lzdvkqrvmi
---
Reports the state of a background discovery task. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:s7Yt7azE -->

This document describes the **seed-rpc-discovery-status** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:suWGAZ3c -->