---
name: Comment (payload)
summary: "A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A d"
schemaDefinition: ipfs://bafyreie3svpjsy65txztspo6m3rq7juvne3ole6sdt2gg5sakgb2qhrrge
---
A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:3cDEwf1- -->

This document describes the **seed-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:dubklf6x -->

# Shape <!-- id:IaBONBBP -->

A **closed struct** with these fields: <!-- id:hxnNqONe -->
  - `id` _(required)_ — [string](./hypermedia-string.md) <!-- id:dcjQthm9 -->
  - `version` _(required)_ — [string](./hypermedia-string.md) <!-- id:J4LrGM2E -->
  - `author` _(required)_ — [string](./hypermedia-string.md) <!-- id:7mfVIRZU -->
  - `targetAccount` _(required)_ — [string](./hypermedia-string.md) <!-- id:yJYYXSde -->
  - `targetPath` — [string](./hypermedia-string.md) <!-- id:-8lj6kOw -->
  - `targetVersion` _(required)_ — [string](./hypermedia-string.md) <!-- id:UAjhTGkE -->
  - `replyParent` — [string](./hypermedia-string.md) <!-- id:c-uNOGGX -->
  - `replyParentVersion` — [string](./hypermedia-string.md) <!-- id:UG5_yEyk -->
  - `threadRoot` — [string](./hypermedia-string.md) <!-- id:asBCWS_Y -->
  - `threadRootVersion` — [string](./hypermedia-string.md) <!-- id:fnFZa1Wa -->
  - `capability` — [string](./hypermedia-string.md) <!-- id:Th6VPgwz -->
  - `content` _(required)_ — list of [hypermedia-block-node](./hypermedia-block-node.md) <!-- id:kMrq60w0 -->
  - `createTime` _(required)_ — [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:GVdcv7Mp -->
  - `updateTime` _(required)_ — [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:B3HL3IYi -->
  - `visibility` _(required)_ — [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:QGBLQ-HM -->

# Depends on <!-- id:Wb9fPfnU -->

- [hypermedia-block-node](./hypermedia-block-node.md) <!-- id:bsiLyW0f -->
- [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:c1mHO1av -->
- [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:cKpRsaIH -->
- [string](./hypermedia-string.md) <!-- id:KfWsCcfr -->
