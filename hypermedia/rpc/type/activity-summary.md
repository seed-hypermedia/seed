---
name: Activity Summary
summary: "The latest-activity digest carried on document listings: the newest comment or change and the unread state."
schemaDefinition: ipfs://bafyreie7vymu3yavlb265c2ugly6gflhd23bzexzjac5pyt3pbew6rswqi
---
Latest-activity digest carried on document listings: newest comment/change and unread state. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:tbPPJsiv -->

This page describes the **rpc/type/activity-summary** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:bA3oqiOv -->

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
