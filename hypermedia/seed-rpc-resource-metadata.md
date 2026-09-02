---
name: "RPC: ResourceMetadata"
summary: "Fetches only a resource's metadata payload. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass;"
schemaDefinition: ipfs://bafyreibf54i3ee7nhprf7oeze2sj5cve75o53sdqx2k2ox2dbieq77fgsu
---
Fetches only a resource's metadata payload. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:C2feHa74 -->

This document describes the **seed-rpc-resource-metadata** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:20rKl8KP -->