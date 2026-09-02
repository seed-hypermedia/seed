---
name: "RPC: ListCapabilities"
summary: "Lists raw capabilities granted on a target. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass;"
schemaDefinition: ipfs://bafyreieagsuztga7fw736clulw4o6i5s2y542fsbwibufv3z7kucawxkpm
---
Lists raw capabilities granted on a target. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:L8_yo2Q9 -->

This document describes the **seed-rpc-list-capabilities** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:IqUUi73s -->