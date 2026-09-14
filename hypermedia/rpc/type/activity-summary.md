---
name: Activity summary
summary: "Latest-activity digest carried on document listings: newest comment/change and unread state. A derived read model computed by the Seed daemon/API for clients — "
schemaDefinition: ipfs://bafyreiax3trluk2i6pmy2vvfkgs35ljhlzm5awbixjvxrkicmvnysf7t64
---
Latest-activity digest carried on document listings: newest comment/change and unread state. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:tbPPJsiv -->

This document describes the **rpc/type/activity-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:bA3oqiOv -->

# Shape <!-- id:OZXG0Zh7 -->

A **closed struct** with these fields: <!-- id:Vs4HGtDy -->
  - `latestCommentTime` — [schema/timestamp](../../schema/timestamp.md) <!-- id:1gqusC11 -->
  - `latestCommentId` _(required)_ — [string](../../schema/string.md) <!-- id:41uUwCp8 -->
  - `commentCount` _(required)_ — `integer` <!-- id:qpnT9nNY -->
  - `latestChangeTime` _(required)_ — [schema/timestamp](../../schema/timestamp.md) <!-- id:yf7D_UC5 -->
  - `isUnread` _(required)_ — [boolean](../../schema/boolean.md) <!-- id:9uyBbD00 -->
  - `childrenCount` — `integer` <!-- id:def8jVg8 -->

# Depends on <!-- id:TszmmNHn -->

- [schema/timestamp](../../schema/timestamp.md) <!-- id:ggrj6Ddw -->
- [boolean](../../schema/boolean.md) <!-- id:oHJaYRhQ -->
- [string](../../schema/string.md) <!-- id:qCF6yVV1 -->
