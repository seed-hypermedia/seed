---
name: "RPC: ListCitations"
summary: "Returns the raw citations that point at a target resource, given its id."
schemaDefinition: ipfs://bafyreifzwfbmojtf5olopsupja2q5pbvavnjmbgakhsefyuyqcsnfiwyye
---
Lists raw citations of a target resource. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:EWDwlcgM -->

This page describes the **rpc/list-citations** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:4clN1Gbd -->

# Shape <!-- id:z2qy10O8 -->

A **closed struct** with these fields: <!-- id:DCfHjHME -->
  - `key` _(required)_ — `"ListCitations"` <!-- id:kLPa7FFC -->
  - `input` _(required)_ — map { 1 fields } <!-- id:764R8Zt5 -->
  - `output` _(required)_ — map { 1 fields } <!-- id:q3KgSdY9 -->

# Depends on <!-- id:Wk6DpqCs -->

- [rpc/type/id](./type/id.md) <!-- id:iS-6L-Uf -->
- [rpc/type/raw-citation](./type/raw-citation.md) <!-- id:Umt7r3Gz -->
