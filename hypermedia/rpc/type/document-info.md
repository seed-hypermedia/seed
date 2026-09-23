---
name: Document Info
summary: "One document in a listing: identity, authorship, timestamps, breadcrumbs, and activity summary, without the full content."
---
One [document](../../protocol/documents.md) in a listing, such as query results or a directory. It carries identity, authorship, timestamps, [breadcrumbs](./breadcrumb.md) and an [activity summary](./activity-summary.md), without the full content. <!-- id:OgH907y3 -->

This page describes the **rpc/type/document-info** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:cNYjZmUW -->

# See also <!-- id:Ayk863xI -->

- [Document (Payload)](./document.md): the full document. <!-- id:e5YYXJFA -->
- [Query Result](./query-result.md): a listing of document info. <!-- id:Q7U8stwj -->
- [Redirect Info](./redirect-info.md): a listed document that redirects. <!-- id:-663LVLt -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:xd9JhQMZ -->
