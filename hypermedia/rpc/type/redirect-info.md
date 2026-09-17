---
name: Redirect Info
summary: Marks a listed document as a redirect to another target, optionally republishing its content in place.
schemaDefinition: ipfs://bafyreiaski2t4sdupe4p6q5mzjqkaecgwwnwwl5epvjtlpwp4wnngnbtby
---
Marks a listed [document](../../protocol/documents.md) as a redirect to another target, optionally republishing its content in place. [Document info](./document-info.md) carries it. <!-- id:q2k72cfx -->

This page describes the **rpc/type/redirect-info** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:2gKj4ehA -->

# Shape <!-- id:kTlL78Cl -->

A **closed struct** with these fields: <!-- id:H9UhYokL -->
  - `type` _(required)_: `"redirect"` <!-- id:BJPYeobL -->
  - `target` _(required)_: [string](../../string.md) <!-- id:yhCOxGRG -->
  - `republish`: [boolean](../../boolean.md) <!-- id:jjdxxctm -->

# Depends on <!-- id:uX4Hsf16 -->

- [boolean](../../boolean.md) <!-- id:ViQ8FoIh -->
- [string](../../string.md) <!-- id:uzKMxK4F -->

# See also <!-- id:wt8DqPIk -->

- [Resource: Redirect](./resource-redirect.md): the redirect state of a fetched resource. <!-- id:tkCu40kf -->
- [Document Info](./document-info.md): the listing entry that carries it. <!-- id:HYA6cfxJ -->
- [Redirect target](../../ref/redirect-target.md): the redirect inside a signed ref. <!-- id:xWNDHkOg -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:hZ0sLOrT -->
