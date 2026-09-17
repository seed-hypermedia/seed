---
name: "RPC: ListEvents"
summary: "Pages through the activity feed as activity events, filtered by author, event type, or resource, with a token for the next page."
schemaDefinition: ipfs://bafyreig6xphaup5axrskzvh6uuqq42rlopkxqp2vk5qmdiijincyx4beyy
---
Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:8NB6bWqQ -->

This page describes the **rpc/list-events** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:CxLVzOd5 -->

# Shape <!-- id:kghUGbcO -->

A **closed struct** with these fields: <!-- id:1xYbf7OV -->
  - `key` _(required)_ — `"ListEvents"` <!-- id:FW4audj7 -->
  - `input` _(required)_ — map { 8 fields } <!-- id:OLNbt9vw -->
  - `output` _(required)_ — map { 2 fields } <!-- id:MV2CZkha -->

# Depends on <!-- id:y34ksrW0 -->

- [boolean](../boolean.md) <!-- id:SyPfcrg3 -->
- [string](../string.md) <!-- id:VrLbVG_X -->
- [rpc/type/activity-event](./type/activity-event.md) <!-- id:K7mTe_LT -->
