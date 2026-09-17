---
name: Raw Document Change
summary: "One change of a document’s history in raw listing form: CID, author, dependency edges, and time."
schemaDefinition: ipfs://bafyreidkk2w4e4lsqqysqhinznab6exkeus36evown7f5szqhziar24igq
---
One [change](../../change.md) in a [document](../../protocol/documents.md)'s history, in raw listing form: CID, author, dependency edges and time. [rpc/list-changes](../list-changes.md) returns these. <!-- id:eHAssQwO -->

This page describes the **rpc/type/raw-document-change** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:QXa2QqTl -->

# Shape <!-- id:FxmCqSQ7 -->

A **closed struct** with these fields: <!-- id:mWeaUv6g -->
  - `id`: [string](../../string.md) <!-- id:Agokfkd5 -->
  - `author`: [string](../../string.md) <!-- id:YpaiMQ30 -->
  - `deps`: list of [string](../../string.md) <!-- id:-2iRqM1r -->
  - `createTime`: [string](../../string.md) <!-- id:TEUlsbe8 -->

# Depends on <!-- id:x-YC6YOj -->

- [string](../../string.md) <!-- id:NePRTnJk -->

# See also <!-- id:WNErak-V -->

- [Change](../../change.md): the signed change blob. <!-- id:IeR4Xs4i -->
- [ListChanges](../list-changes.md): the method that returns it. <!-- id:_E_9BALY -->
- [Documents](../../protocol/documents.md): the change DAG. <!-- id:aMjOdxSR -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:_qmsCsy_ -->
