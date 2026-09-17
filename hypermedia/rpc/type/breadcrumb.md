---
name: Breadcrumb
summary: One ancestor entry of a document’s path, resolved to a display name.
schemaDefinition: ipfs://bafyreifxhft5lto4yecrnypy2db7tfqfx36l4jelbs5vwmmvider2qhnue
---
One ancestor in a [document](../../protocol/documents.md)'s path, resolved to a display name. [Document info](./document-info.md) lists them. <!-- id:Hx0g4ljG -->

This page describes the **rpc/type/breadcrumb** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:aIHoVIzJ -->

# Shape <!-- id:7Ey_ElAb -->

A **closed struct** with these fields: <!-- id:GaJkyvmU -->
  - `name` _(required)_: [string](../../string.md) <!-- id:KeXz3K4U -->
  - `path` _(required)_: [string](../../string.md) <!-- id:JM-WnnRQ -->
  - `isMissing`: [boolean](../../boolean.md) <!-- id:O1QZ1BQ3 -->

# Depends on <!-- id:60zxuRgg -->

- [boolean](../../boolean.md) <!-- id:rTTj3a7l -->
- [string](../../string.md) <!-- id:vSJ_3OOj -->

# See also <!-- id:h12-zs6B -->

- [Document Info](./document-info.md): the listing entry that carries breadcrumbs. <!-- id:ju1-n3-Y -->
- [Documents](../../protocol/documents.md): paths and directories. <!-- id:TJ-_w65W -->
- [Search Result Item](./search-result-item.md): search hits with parent names. <!-- id:2CV4cYpc -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:osvTgjWc -->
