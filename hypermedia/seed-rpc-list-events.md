---
name: "RPC: ListEvents"
summary: "Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fi"
schemaDefinition: ipfs://bafyreieiotkkhbzoamsloiunryvtup2nz54gxf7hu7x2fpapeizdzj4ug4
---
Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:8NB6bWqQ -->

This document describes the **seed-rpc-list-events** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:CxLVzOd5 -->