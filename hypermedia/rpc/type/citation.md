---
name: Citation
summary: "One mention of a target resource from elsewhere on the network: the citing source (a document 'd' or a comment 'c'), whether it pinned the exact version, and th"
schemaDefinition: ipfs://bafyreiabygcgnkdkrduuohiqkttjud24zb352jqlmc3xp7anwdqvdbwlqy
---
One mention of a target resource from elsewhere on the network: the citing source (a document 'd' or a comment 'c'), whether it pinned the exact version, and the fragment it points at. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:vp-ojCpz -->

This document describes the **rpc/type/citation** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:MOh8ryRo -->

# Shape <!-- id:rbyri4dZ -->

A **closed struct** with these fields: <!-- id:VmqoRbRO -->
  - `source` _(required)_ — one of map { 4 fields } | map { 4 fields } <!-- id:MdIAs04J -->
  - `isExactVersion` _(required)_ — [boolean](../../schema/boolean.md) <!-- id:UJZmjhTF -->
  - `targetFragment` _(required)_ — one of [rpc/type/parsed-fragment](./parsed-fragment.md) | [null](../../schema/null.md) <!-- id:wzdqS34J -->
  - `targetId` _(required)_ — [rpc/type/id](./id.md) <!-- id:StfBx79G -->

# Depends on <!-- id:DfdIjFgi -->

- [schema/timestamp](../../schema/timestamp.md) <!-- id:qmlMMX_K -->
- [boolean](../../schema/boolean.md) <!-- id:bMN0_lDm -->
- [null](../../schema/null.md) <!-- id:y97zthBM -->
- [string](../../schema/string.md) <!-- id:Ecgkvu07 -->
- [rpc/type/id](./id.md) <!-- id:ZVKjgJT0 -->
- [rpc/type/parsed-fragment](./parsed-fragment.md) <!-- id:sJ6YEHCt -->
