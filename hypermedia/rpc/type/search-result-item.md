---
name: Search Result Item
summary: "One hit of a network search: the matched id with its title, icon, and breadcrumb parent names, and what kind of entity matched."
---
One hit of a network search: the matched id with its title, icon and breadcrumb parent names, and the kind of entity that matched: a [document](../../protocol/documents.md), a [contact](../../protocol/permissions.md) or a [comment](../../protocol/comments.md). <!-- id:qXiY7SqP -->

This page describes the **rpc/type/search-result-item** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:NqIvQcGm -->

# See also <!-- id:R8fwx08_ -->

- [Search Results](./search-results.md): a page of hits. <!-- id:nSnUvueW -->
- [Search](../search.md): the method that searches. <!-- id:b-x06Qjw -->
- [Breadcrumb](./breadcrumb.md): path entries on listings. <!-- id:JSdBEQL4 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:a4KAKKJR -->
