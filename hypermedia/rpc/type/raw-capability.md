---
name: Raw Capability
summary: "A capability as indexed, in raw wire form with every field an optional string."
schemaDefinition: ipfs://bafyreigfiezikcnqijvqas7qelgo2alxhblaxu7pbrghcn4lzw33mx2nea
---
A [capability](../../protocol/permissions.md) as the daemon indexes it, in raw wire form where every field is an optional string. [rpc/list-capabilities](../list-capabilities.md) returns these. <!-- id:S4b_KI-P -->

This page describes the **rpc/type/raw-capability** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:PjpY-Hh8 -->

# Shape <!-- id:kxlkQVIw -->

A **closed struct** with these fields: <!-- id:7_GLzvLR -->
  - `id`: [string](../../string.md) <!-- id:U2Qviex5 -->
  - `issuer`: [string](../../string.md) <!-- id:yOvtdkqY -->
  - `delegate`: [string](../../string.md) <!-- id:TGDpUXn0 -->
  - `account`: [string](../../string.md) <!-- id:4suz9Snp -->
  - `path`: [string](../../string.md) <!-- id:eYzicjYG -->
  - `role`: [string](../../string.md) <!-- id:d4nXy9NT -->
  - `noRecursive`: [boolean](../../boolean.md) <!-- id:vSzBLiYk -->
  - `label`: [string](../../string.md) <!-- id:YkFuZisn -->
  - `createTime`: [string](../../string.md) <!-- id:naEyeK_O -->

# Depends on <!-- id:kqu-NLeV -->

- [boolean](../../boolean.md) <!-- id:VgTRhZY0 -->
- [string](../../string.md) <!-- id:Lc5Z-FdC -->

# See also

- [Capability (Payload)](./capability.md): the resolved form.
- [Capability](../../capability.md): the signed capability blob.
- [ListCapabilities](../list-capabilities.md): the method that returns it.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
