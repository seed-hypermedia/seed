---
name: Activity summary
summary: "Latest-activity digest carried on document listings: newest comment/change and unread state. A derived read model computed by the Seed daemon/API for clients — "
schemaDefinition: ipfs://bafyreibf6trx5ftap6ucw26brtus2vv7ma3qkjtcmfa4wbnmogqjhme2re
---
Latest-activity digest carried on document listings: newest comment/change and unread state. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:tbPPJsiv -->

This document describes the **seed-activity-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:bA3oqiOv -->

# Shape <!-- id:OZXG0Zh7 -->

A **closed struct** with these fields: <!-- id:Vs4HGtDy -->
  - `latestCommentTime` — [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:1gqusC11 -->
  - `latestCommentId` _(required)_ — [string](./onyx-string.md) <!-- id:41uUwCp8 -->
  - `commentCount` _(required)_ — `integer` <!-- id:qpnT9nNY -->
  - `latestChangeTime` _(required)_ — [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:yf7D_UC5 -->
  - `isUnread` _(required)_ — [boolean](./onyx-boolean.md) <!-- id:9uyBbD00 -->
  - `childrenCount` — `integer` <!-- id:def8jVg8 -->

# Depends on <!-- id:TszmmNHn -->

- [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:ggrj6Ddw -->
- [boolean](./onyx-boolean.md) <!-- id:oHJaYRhQ -->
- [string](./onyx-string.md) <!-- id:qCF6yVV1 -->
