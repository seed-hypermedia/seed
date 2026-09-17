---
name: Metadata Payload
summary: "A resource id with its resolved metadata, or null when the document has none."
schemaDefinition: ipfs://bafyreiaxowaql3pnjqlnli3bngkfzdqfink5pkz4ukivhssxzw6j466q7u
---
A [resource](../../glossary.md) id with its resolved [metadata](../../metadata.md). `metadata` is `null` when the document has none. <!-- id:Y5u7CGw2 -->

This page describes the **rpc/type/metadata-payload** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:uXMpvOl- -->

# Shape <!-- id:XIHou5Ec -->

A **closed struct** with these fields: <!-- id:0j_x3TEg -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:mHdVfkvN -->
  - `metadata` _(required)_: one of [metadata](../../metadata.md) | [null](../../null.md) <!-- id:l5DeUFH2 -->
  - `hasSite`: [boolean](../../boolean.md) <!-- id:ElbUiqOU -->

# Depends on <!-- id:jWMfRp8f -->

- [metadata](../../metadata.md) <!-- id:YHNL_4BR -->
- [boolean](../../boolean.md) <!-- id:KXwYZO0v -->
- [null](../../null.md) <!-- id:6NloaXgX -->
- [rpc/type/id](./id.md) <!-- id:L9kGhYH8 -->

# See also

- [ResourceMetadata](../resource-metadata.md): the method that returns it.
- [Accounts Metadata](./accounts-metadata.md): a map of these by account.
- [Metadata](../../metadata.md): every metadata key.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
