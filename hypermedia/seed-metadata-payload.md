---
name: Metadata payload
summary: A resource id with its resolved metadata (null when the document has none). A derived read model computed by the Seed daemon/API for clients — not a signed netw
schemaDefinition: ipfs://bafyreibziy5u7ztcytdpqf3vcjnhudygo4vtmd52kyrkoqk7p7bzwafvtm
---
A resource id with its resolved metadata (null when the document has none). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:Y5u7CGw2 -->

This document describes the **seed-metadata-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:uXMpvOl- -->

# Shape <!-- id:XIHou5Ec -->

A **closed struct** with these fields: <!-- id:0j_x3TEg -->
  - `id` _(required)_ — [seed-id](./seed-id.md) <!-- id:mHdVfkvN -->
  - `metadata` _(required)_ — one of [hypermedia-metadata](./hypermedia-metadata.md) | [null](./hypermedia-null.md) <!-- id:l5DeUFH2 -->
  - `hasSite` — [boolean](./hypermedia-boolean.md) <!-- id:ElbUiqOU -->

# Depends on <!-- id:jWMfRp8f -->

- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:YHNL_4BR -->
- [boolean](./hypermedia-boolean.md) <!-- id:KXwYZO0v -->
- [null](./hypermedia-null.md) <!-- id:6NloaXgX -->
- [seed-id](./seed-id.md) <!-- id:L9kGhYH8 -->
