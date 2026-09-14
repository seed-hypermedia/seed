---
name: Comment Group
summary: A thread of comments grouped for display, with a count of elided replies. A derived read model computed by the Seed daemon/API for clients — not a signed networ
schemaDefinition: ipfs://bafyreihplsnosg7q4bd3i7fgw7fswgmipxicbyxc6relldopewzmvylwte
---
A thread of comments grouped for display, with a count of elided replies. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:kfaho3GA -->

This document describes the **rpc/type/comment-group** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XEbgwnCN -->

# Shape <!-- id:bn9hhdhT -->

A **closed struct** with these fields: <!-- id:hQ_A0BRE -->
  - `comments` _(required)_ — list of [rpc/type/comment](./comment.md) <!-- id:6j0dIlAA -->
  - `moreCommentsCount` _(required)_ — `integer` <!-- id:YX7_v3Cs -->
  - `id` _(required)_ — [string](../../string.md) <!-- id:LESTYzIE -->
  - `type` _(required)_ — `"commentGroup"` <!-- id:8G00dDGM -->

# Depends on <!-- id:zRpGsTRj -->

- [string](../../string.md) <!-- id:Cmnm7JiI -->
- [rpc/type/comment](./comment.md) <!-- id:fg2iMFOh -->
