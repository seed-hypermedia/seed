---
name: Comment list
summary: "A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network "
schemaDefinition: ipfs://bafyreiazppljvnf2oackc7vq4cusseimz54wdg75gcfhcn6qyc64ekqsw4
---
A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:YsLbrH3B -->

This document describes the **seed-comment-list** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NORHzsPw -->

# Shape <!-- id:PppnBW7I -->

A **closed struct** with these fields: <!-- id:KZctBNHM -->
  - `comments` _(required)_ — list of [seed-comment](./seed-comment.md) <!-- id:kVFQBkzL -->
  - `authors` _(required)_ — map ⟨ \* : [seed-metadata-payload](./seed-metadata-payload.md) ⟩ <!-- id:ZBgvETJb -->

# Depends on <!-- id:Xlb8F54n -->

- [seed-comment](./seed-comment.md) <!-- id:uEtChrVR -->
- [seed-metadata-payload](./seed-metadata-payload.md) <!-- id:Dt3ONyxv -->
