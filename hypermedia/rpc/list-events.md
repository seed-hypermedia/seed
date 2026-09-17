---
name: "RPC: ListEvents"
summary: Pages through the activity feed as activity events, filtered by author, event type, or resource, with a token for the next page.
schemaDefinition: ipfs://bafyreig6xphaup5axrskzvh6uuqq42rlopkxqp2vk5qmdiijincyx4beyy
---
Pages through the activity feed of [activity events](./type/activity-event.md). You can filter by author, event type or [resource](../glossary.md), and each page returns a token for the next one. <!-- id:8NB6bWqQ -->

This page describes the **rpc/list-events** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:CxLVzOd5 -->

# Shape <!-- id:kghUGbcO -->

A **closed struct** with these fields: <!-- id:1xYbf7OV -->
  - `key` _(required)_: `"ListEvents"` <!-- id:FW4audj7 -->
  - `input` _(required)_: map { 8 fields } <!-- id:OLNbt9vw -->
  - `output` _(required)_: map { 2 fields } <!-- id:MV2CZkha -->

# Depends on <!-- id:y34ksrW0 -->

- [boolean](../boolean.md) <!-- id:SyPfcrg3 -->
- [string](../string.md) <!-- id:VrLbVG_X -->
- [rpc/type/activity-event](./type/activity-event.md) <!-- id:K7mTe_LT -->

# See also <!-- id:L2Esm_W_ -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:ESDEClUe -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:WWPWZFy2 -->
- [RPC](./method.md): every method in one union. <!-- id:DJg0Thc9 -->
- [Glossary](../glossary.md): resources and other terms. <!-- id:SJZVe4ix -->
- [Comments](../protocol/comments.md): comment events. <!-- id:7o_2oREK -->
- [Documents](../protocol/documents.md): change events. <!-- id:vBudMGoN -->
