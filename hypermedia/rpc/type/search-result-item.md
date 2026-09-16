---
name: Search Result Item
summary: "One hit of a network search: the matched id with display info (title, icon, breadcrumb parent names) and what kind of entity matched. A derived read model compu"
schemaDefinition: ipfs://bafyreicjanyuetbb2mtgtkyrmom25ybitikvme6suyx3phww4cmxajbcaq
---
One hit of a network search: the matched id with display info (title, icon, breadcrumb parent names) and what kind of entity matched. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:qXiY7SqP -->

This document describes the **rpc/type/search-result-item** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NqIvQcGm -->

# Shape <!-- id:7_SrO2k5 -->

A **closed struct** with these fields: <!-- id:funk1VF2 -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:u3BNAqJ- -->
  - `commentId` — [string](../../string.md) <!-- id:zE7xXAp- -->
  - `metadata` — [metadata](../../metadata.md) <!-- id:fu8241-R -->
  - `title` _(required)_ — [string](../../string.md) <!-- id:aUnRcaQs -->
  - `icon` _(required)_ — [string](../../string.md) <!-- id:nXDyjj9x -->
  - `parentNames` _(required)_ — list of [string](../../string.md) <!-- id:5J6naQQF -->
  - `versionTime` — [string](../../string.md) <!-- id:eRekKhdW -->
  - `searchQuery` _(required)_ — [string](../../string.md) <!-- id:RrP0uj-3 -->
  - `type` _(required)_ — one of `"document"` | `"contact"` | `"comment"` <!-- id:ow59ehEv -->

# Depends on <!-- id:ikD0x8fX -->

- [metadata](../../metadata.md) <!-- id:e03fcW5T -->
- [string](../../string.md) <!-- id:u5Z_32fj -->
- [rpc/type/id](./id.md) <!-- id:FD_zY--5 -->
