---
name: Comment (Payload)
summary: "A comment as the API returns it: the signed comment’s content plus derived fields such as stable id, version CID, thread links, timestamps, and visibility."
schemaDefinition: ipfs://bafyreigopzzymjrehpqrv747uygm4njri6gvbfvuhlsasnwtaxb4lrwdou
---
A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:3cDEwf1- -->

This page describes the **rpc/type/comment** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:dubklf6x -->

# Shape <!-- id:IaBONBBP -->

A **closed struct** with these fields: <!-- id:hxnNqONe -->
  - `id` _(required)_: [string](../../string.md) <!-- id:dcjQthm9 -->
  - `version` _(required)_: [string](../../string.md) <!-- id:J4LrGM2E -->
  - `author` _(required)_: [string](../../string.md) <!-- id:7mfVIRZU -->
  - `targetAccount` _(required)_: [string](../../string.md) <!-- id:yJYYXSde -->
  - `targetPath`: [string](../../string.md) <!-- id:-8lj6kOw -->
  - `targetVersion` _(required)_: [string](../../string.md) <!-- id:UAjhTGkE -->
  - `replyParent`: [string](../../string.md) <!-- id:c-uNOGGX -->
  - `replyParentVersion`: [string](../../string.md) <!-- id:UG5_yEyk -->
  - `threadRoot`: [string](../../string.md) <!-- id:asBCWS_Y -->
  - `threadRootVersion`: [string](../../string.md) <!-- id:fnFZa1Wa -->
  - `capability`: [string](../../string.md) <!-- id:Th6VPgwz -->
  - `content` _(required)_: list of [block/node](../../block/node.md) <!-- id:kMrq60w0 -->
  - `createTime` _(required)_: [timestamp](../../timestamp.md) <!-- id:GVdcv7Mp -->
  - `updateTime` _(required)_: [timestamp](../../timestamp.md) <!-- id:B3HL3IYi -->
  - `visibility` _(required)_: [visibility](../../visibility.md) <!-- id:QGBLQ-HM -->

# Depends on <!-- id:Wb9fPfnU -->

- [block/node](../../block/node.md) <!-- id:bsiLyW0f -->
- [timestamp](../../timestamp.md) <!-- id:c1mHO1av -->
- [visibility](../../visibility.md) <!-- id:cKpRsaIH -->
- [string](../../string.md) <!-- id:KfWsCcfr -->
