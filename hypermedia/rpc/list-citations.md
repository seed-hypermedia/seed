---
name: "RPC: ListCitations"
summary: "Lists raw citations of a target resource. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `"
schemaDefinition: ipfs://bafyreieonco7b35z7dpceodh2mifs2v6s25vwdyoefsvzzlbq246dtpbhi
---
Lists raw citations of a target resource. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:EWDwlcgM -->

This document describes the **rpc/list-citations** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:4clN1Gbd -->

# Shape <!-- id:z2qy10O8 -->

A **closed struct** with these fields: <!-- id:DCfHjHME -->
  - `key` _(required)_ — `"ListCitations"` <!-- id:kLPa7FFC -->
  - `input` _(required)_ — map { 1 fields } <!-- id:764R8Zt5 -->
  - `output` _(required)_ — map { 1 fields } <!-- id:q3KgSdY9 -->

# Depends on <!-- id:Wk6DpqCs -->

- [rpc/type/id](./type/id.md) <!-- id:iS-6L-Uf -->
- [rpc/type/raw-citation](./type/raw-citation.md) <!-- id:Umt7r3Gz -->
