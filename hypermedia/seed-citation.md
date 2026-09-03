---
name: Citation
summary: "One mention of a target resource from elsewhere on the network: the citing source (a document 'd' or a comment 'c'), whether it pinned the exact version, and th"
schemaDefinition: ipfs://bafyreicwyk4l22ingsymhhd73eaf3baljbalzcmqbsn7kcylsaaum7ysji
---
One mention of a target resource from elsewhere on the network: the citing source (a document 'd' or a comment 'c'), whether it pinned the exact version, and the fragment it points at. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:vp-ojCpz -->

This document describes the **seed-citation** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:MOh8ryRo -->

# Shape <!-- id:rbyri4dZ -->

A **closed struct** with these fields: <!-- id:VmqoRbRO -->
  - `source` _(required)_ — one of map { 4 fields } | map { 4 fields } <!-- id:MdIAs04J -->
  - `isExactVersion` _(required)_ — [boolean](./onyx-boolean.md) <!-- id:UJZmjhTF -->
  - `targetFragment` _(required)_ — one of [seed-parsed-fragment](./seed-parsed-fragment.md) | [null](./onyx-null.md) <!-- id:wzdqS34J -->
  - `targetId` _(required)_ — [seed-id](./seed-id.md) <!-- id:StfBx79G -->

# Depends on <!-- id:DfdIjFgi -->

- [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:qmlMMX_K -->
- [boolean](./onyx-boolean.md) <!-- id:bMN0_lDm -->
- [null](./onyx-null.md) <!-- id:y97zthBM -->
- [string](./onyx-string.md) <!-- id:Ecgkvu07 -->
- [seed-id](./seed-id.md) <!-- id:ZVKjgJT0 -->
- [seed-parsed-fragment](./seed-parsed-fragment.md) <!-- id:sJ6YEHCt -->
