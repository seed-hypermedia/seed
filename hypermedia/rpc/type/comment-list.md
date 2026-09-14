---
name: Comment list
summary: "A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network "
schemaDefinition: ipfs://bafyreifbvdedmv4xnaqfnqexuqv6mgykm3d3r5oigdzi7sd5zygnrxgoza
---
A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:YsLbrH3B -->

This document describes the **rpc/type/comment-list** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NORHzsPw -->

# Shape <!-- id:PppnBW7I -->

A **closed struct** with these fields: <!-- id:KZctBNHM -->
  - `comments` _(required)_ — list of [rpc/type/comment](./comment.md) <!-- id:kVFQBkzL -->
  - `authors` _(required)_ — map ⟨ \* : [rpc/type/metadata-payload](./metadata-payload.md) ⟩ <!-- id:ZBgvETJb -->

# Depends on <!-- id:Xlb8F54n -->

- [rpc/type/comment](./comment.md) <!-- id:uEtChrVR -->
- [rpc/type/metadata-payload](./metadata-payload.md) <!-- id:Dt3ONyxv -->
