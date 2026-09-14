---
name: Raw Document Change
summary: "One change of a document's history in raw listing form: CID, author, dependency edges, time. A derived read model computed by the Seed daemon/API for clients — "
schemaDefinition: ipfs://bafyreibcfnysinjhkc2osslyejslbzr7akv76lacntmnamapbntpc7k72y
---
One change of a document's history in raw listing form: CID, author, dependency edges, time. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:eHAssQwO -->

This document describes the **rpc/type/raw-document-change** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QXa2QqTl -->

# Shape <!-- id:FxmCqSQ7 -->

A **closed struct** with these fields: <!-- id:mWeaUv6g -->
  - `id` — [string](../../schema/string.md) <!-- id:Agokfkd5 -->
  - `author` — [string](../../schema/string.md) <!-- id:YpaiMQ30 -->
  - `deps` — list of [string](../../schema/string.md) <!-- id:-2iRqM1r -->
  - `createTime` — [string](../../schema/string.md) <!-- id:TEUlsbe8 -->

# Depends on <!-- id:x-YC6YOj -->

- [string](../../schema/string.md) <!-- id:NePRTnJk -->
