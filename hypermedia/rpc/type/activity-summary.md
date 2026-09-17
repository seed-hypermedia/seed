---
name: Activity Summary
summary: "The latest-activity digest carried on document listings: the newest comment or change and the unread state."
schemaDefinition: ipfs://bafyreie7vymu3yavlb265c2ugly6gflhd23bzexzjac5pyt3pbew6rswqi
---
The latest-activity digest on [document](../../protocol/documents.md) listings: the newest [comment](../../protocol/comments.md) or [change](../../change.md), and the unread state. It is part of [document info](./document-info.md). <!-- id:tbPPJsiv -->

This page describes the **rpc/type/activity-summary** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:bA3oqiOv -->

# Shape <!-- id:OZXG0Zh7 -->

A **closed struct** with these fields: <!-- id:Vs4HGtDy -->
  - `latestCommentTime`: [timestamp](../../timestamp.md) <!-- id:1gqusC11 -->
  - `latestCommentId` _(required)_: [string](../../string.md) <!-- id:41uUwCp8 -->
  - `commentCount` _(required)_: `integer` <!-- id:qpnT9nNY -->
  - `latestChangeTime` _(required)_: [timestamp](../../timestamp.md) <!-- id:yf7D_UC5 -->
  - `isUnread` _(required)_: [boolean](../../boolean.md) <!-- id:9uyBbD00 -->
  - `childrenCount`: `integer` <!-- id:def8jVg8 -->

# Depends on <!-- id:TszmmNHn -->

- [timestamp](../../timestamp.md) <!-- id:ggrj6Ddw -->
- [boolean](../../boolean.md) <!-- id:oHJaYRhQ -->
- [string](../../string.md) <!-- id:qCF6yVV1 -->

# See also

- [Document Info](./document-info.md): the listing entry that carries it.
- [ListEvents](../list-events.md): the full activity feed.
- [Interaction Summary](./interaction-summary.md): aggregate counts for a document.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
