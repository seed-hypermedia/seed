---
name: Comment (Payload)
summary: "A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A d"
schemaDefinition: ipfs://bafyreigvkjvqrutotwfpl23ia7romd7wmsu26lxox53lhqk6bz4wgyef4u
---
A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:3cDEwf1- -->

This document describes the **rpc/type/comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:dubklf6x -->

# Shape <!-- id:IaBONBBP -->

A **closed struct** with these fields: <!-- id:hxnNqONe -->
  - `id` _(required)_ — [string](../../schema/string.md) <!-- id:dcjQthm9 -->
  - `version` _(required)_ — [string](../../schema/string.md) <!-- id:J4LrGM2E -->
  - `author` _(required)_ — [string](../../schema/string.md) <!-- id:7mfVIRZU -->
  - `targetAccount` _(required)_ — [string](../../schema/string.md) <!-- id:yJYYXSde -->
  - `targetPath` — [string](../../schema/string.md) <!-- id:-8lj6kOw -->
  - `targetVersion` _(required)_ — [string](../../schema/string.md) <!-- id:UAjhTGkE -->
  - `replyParent` — [string](../../schema/string.md) <!-- id:c-uNOGGX -->
  - `replyParentVersion` — [string](../../schema/string.md) <!-- id:UG5_yEyk -->
  - `threadRoot` — [string](../../schema/string.md) <!-- id:asBCWS_Y -->
  - `threadRootVersion` — [string](../../schema/string.md) <!-- id:fnFZa1Wa -->
  - `capability` — [string](../../schema/string.md) <!-- id:Th6VPgwz -->
  - `content` _(required)_ — list of [schema/block/node](../../schema/block/node.md) <!-- id:kMrq60w0 -->
  - `createTime` _(required)_ — [schema/timestamp](../../schema/timestamp.md) <!-- id:GVdcv7Mp -->
  - `updateTime` _(required)_ — [schema/timestamp](../../schema/timestamp.md) <!-- id:B3HL3IYi -->
  - `visibility` _(required)_ — [visibility](../../visibility.md) <!-- id:QGBLQ-HM -->

# Depends on <!-- id:Wb9fPfnU -->

- [schema/block/node](../../schema/block/node.md) <!-- id:bsiLyW0f -->
- [schema/timestamp](../../schema/timestamp.md) <!-- id:c1mHO1av -->
- [visibility](../../visibility.md) <!-- id:cKpRsaIH -->
- [string](../../schema/string.md) <!-- id:KfWsCcfr -->
