---
name: Raw document change
summary: "One change of a document's history in raw listing form: CID, author, dependency edges, time. A derived read model computed by the Seed daemon/API for clients — "
schemaDefinition: ipfs://bafyreieewgum24v74ogfdppfxb3nzvikpbe7i3qyy3d5o6sc2n4asry3ni
---
One change of a document's history in raw listing form: CID, author, dependency edges, time. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:eHAssQwO -->

This document describes the **seed-raw-document-change** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QXa2QqTl -->

# Shape <!-- id:FxmCqSQ7 -->

A **closed struct** with these fields: <!-- id:mWeaUv6g -->
  - `id` — [string](./hypermedia-string.md) <!-- id:Agokfkd5 -->
  - `author` — [string](./hypermedia-string.md) <!-- id:YpaiMQ30 -->
  - `deps` — list of [string](./hypermedia-string.md) <!-- id:-2iRqM1r -->
  - `createTime` — [string](./hypermedia-string.md) <!-- id:TEUlsbe8 -->

# Depends on <!-- id:x-YC6YOj -->

- [string](./hypermedia-string.md) <!-- id:NePRTnJk -->
