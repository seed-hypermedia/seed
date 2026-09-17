---
name: Search Result Item
summary: "One hit of a network search: the matched id with its title, icon, and breadcrumb parent names, and what kind of entity matched."
schemaDefinition: ipfs://bafyreicjanyuetbb2mtgtkyrmom25ybitikvme6suyx3phww4cmxajbcaq
---
One hit of a network search: the matched id with its title, icon and breadcrumb parent names, and the kind of entity that matched: a [document](../../protocol/documents.md), a [contact](../../protocol/permissions.md) or a [comment](../../protocol/comments.md). <!-- id:qXiY7SqP -->

This page describes the **rpc/type/search-result-item** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:NqIvQcGm -->

# Shape <!-- id:7_SrO2k5 -->

A **closed struct** with these fields: <!-- id:funk1VF2 -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:u3BNAqJ- -->
  - `commentId`: [string](../../string.md) <!-- id:zE7xXAp- -->
  - `metadata`: [metadata](../../metadata.md) <!-- id:fu8241-R -->
  - `title` _(required)_: [string](../../string.md) <!-- id:aUnRcaQs -->
  - `icon` _(required)_: [string](../../string.md) <!-- id:nXDyjj9x -->
  - `parentNames` _(required)_: list of [string](../../string.md) <!-- id:5J6naQQF -->
  - `versionTime`: [string](../../string.md) <!-- id:eRekKhdW -->
  - `searchQuery` _(required)_: [string](../../string.md) <!-- id:RrP0uj-3 -->
  - `type` _(required)_: one of `"document"` | `"contact"` | `"comment"` <!-- id:ow59ehEv -->

# Depends on <!-- id:ikD0x8fX -->

- [metadata](../../metadata.md) <!-- id:e03fcW5T -->
- [string](../../string.md) <!-- id:u5Z_32fj -->
- [rpc/type/id](./id.md) <!-- id:FD_zY--5 -->

# See also

- [Search Results](./search-results.md): a page of hits.
- [Search](../search.md): the method that searches.
- [Breadcrumb](./breadcrumb.md): path entries on listings.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
