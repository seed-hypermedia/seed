---
name: Parsed ID
summary: A parsed hm:// identifier as clients pass it around (account uid, path segments, pinned version, block reference, origin hints), with null for whatever the URL does not carry.
---
A parsed [hm:// URL](../../protocol/urls.md) as clients pass it around: [account](../../protocol/identity.md) uid, path segments, pinned [version](../../protocol/documents.md), [block](../../protocol/blocks.md) reference and origin hints. Fields the URL does not carry are `null`. <!-- id:_G2YLDZ8 -->

This page describes the **rpc/type/id** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:XTZhL1KF -->

# See also <!-- id:6yQobwi_ -->

- [Hypermedia URLs](../../protocol/urls.md): the URL format. <!-- id:KQaS1D_Q -->
- [Block Range](./block-range.md): the range inside a block reference. <!-- id:VI6r9Ee1 -->
- [Resource](../resource.md): the method that takes a parsed id. <!-- id:Nladq2F0 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:gNIRkh4H -->
