---
name: "RPC: Resource"
summary: "Fetches a resource (document, comment, redirect, …) by parsed id. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fiel"
schemaDefinition: ipfs://bafyreict2mtqxurmi5l3jp5zqbjljmz62gornrlaknyboy3oac74ttownq
---
Fetches a resource (document, comment, redirect, …) by parsed id. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:0FgdDO0r -->

This document describes the **seed-rpc-resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qsZY_yJS -->