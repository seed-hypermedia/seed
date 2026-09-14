---
name: Metadata Payload
summary: A resource id with its resolved metadata (null when the document has none). A derived read model computed by the Seed daemon/API for clients — not a signed netw
schemaDefinition: ipfs://bafyreibf7de5symybvpuv5ucdexrtextccgj76kytdrpargfjwdpmjvikm
---
A resource id with its resolved metadata (null when the document has none). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:Y5u7CGw2 -->

This document describes the **rpc/type/metadata-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:uXMpvOl- -->

# Shape <!-- id:XIHou5Ec -->

A **closed struct** with these fields: <!-- id:0j_x3TEg -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:mHdVfkvN -->
  - `metadata` _(required)_ — one of [metadata](../../metadata.md) | [null](../../schema/null.md) <!-- id:l5DeUFH2 -->
  - `hasSite` — [boolean](../../schema/boolean.md) <!-- id:ElbUiqOU -->

# Depends on <!-- id:jWMfRp8f -->

- [metadata](../../metadata.md) <!-- id:YHNL_4BR -->
- [boolean](../../schema/boolean.md) <!-- id:KXwYZO0v -->
- [null](../../schema/null.md) <!-- id:6NloaXgX -->
- [rpc/type/id](./id.md) <!-- id:L9kGhYH8 -->
