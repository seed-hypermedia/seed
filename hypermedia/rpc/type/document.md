---
name: Document (Payload)
summary: "A document as the API returns it: the signed document’s metadata and content plus derived fields such as resolved version, authors, timestamps, and visibility."
---
A [document](../../protocol/documents.md) as the API returns it: the signed document's [metadata](../../metadata.md) and [content](../../protocol/blocks.md), plus derived fields such as the resolved version, authors, timestamps and [visibility](../../protocol/privacy.md). [rpc/resource](../resource.md) returns it inside a [document resource](./resource-document.md). <!-- id:rHH1177g -->

This page describes the **rpc/type/document** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:QZ19vXgV -->

# See also <!-- id:Mpyfk2Cc -->

- [Document](../../document.md): the document term page. <!-- id:pBq5dti4 -->
- [Documents](../../protocol/documents.md): changes, refs and versions. <!-- id:Nbv54P6F -->
- [Document Info](./document-info.md): the listing form without content. <!-- id:-Ml8Zu_i -->
- [Resource](../resource.md): the method that fetches documents. <!-- id:CNlgmGJa -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:an2uAvPl -->
