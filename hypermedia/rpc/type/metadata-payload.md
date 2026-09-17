---
name: Metadata Payload
summary: A resource id with its resolved metadata, or null when the document has none.
---
A [resource](../../glossary.md) id with its resolved [metadata](../../metadata.md). `metadata` is `null` when the document has none. <!-- id:Y5u7CGw2 -->

This page describes the **rpc/type/metadata-payload** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:uXMpvOl- -->

# See also <!-- id:h53Azurw -->

- [ResourceMetadata](../resource-metadata.md): the method that returns it. <!-- id:QNG2OY8Z -->
- [Accounts Metadata](./accounts-metadata.md): a map of these by account. <!-- id:EumtKVZU -->
- [Metadata](../../metadata.md): every metadata key. <!-- id:vdvTEhUW -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:iZtfwmfH -->
