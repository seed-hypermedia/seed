---
name: Search result item
summary: "One hit of a network search: the matched id with display info (title, icon, breadcrumb parent names) and what kind of entity matched. A derived read model compu"
schemaDefinition: ipfs://bafyreihrnvops7thfow5axoouagev6h4r5bxdinekf66ogh5ggsjgz3fru
---
One hit of a network search: the matched id with display info (title, icon, breadcrumb parent names) and what kind of entity matched. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:qXiY7SqP -->

This document describes the **rpc/type/search-result-item** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NqIvQcGm -->

# Shape <!-- id:7_SrO2k5 -->

A **closed struct** with these fields: <!-- id:funk1VF2 -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:u3BNAqJ- -->
  - `commentId` — [string](../../schema/string.md) <!-- id:zE7xXAp- -->
  - `metadata` — [metadata](../../metadata.md) <!-- id:fu8241-R -->
  - `title` _(required)_ — [string](../../schema/string.md) <!-- id:aUnRcaQs -->
  - `icon` _(required)_ — [string](../../schema/string.md) <!-- id:nXDyjj9x -->
  - `parentNames` _(required)_ — list of [string](../../schema/string.md) <!-- id:5J6naQQF -->
  - `versionTime` — [string](../../schema/string.md) <!-- id:eRekKhdW -->
  - `searchQuery` _(required)_ — [string](../../schema/string.md) <!-- id:RrP0uj-3 -->
  - `type` _(required)_ — one of `"document"` | `"contact"` | `"comment"` <!-- id:ow59ehEv -->

# Depends on <!-- id:ikD0x8fX -->

- [metadata](../../metadata.md) <!-- id:e03fcW5T -->
- [string](../../schema/string.md) <!-- id:u5Z_32fj -->
- [rpc/type/id](./id.md) <!-- id:FD_zY--5 -->
