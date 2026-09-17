---
name: "RPC: Resource"
summary: "Fetches a resource by parsed id and returns whichever state it is in: document, comment, redirect, not found, tombstone, or error."
schemaDefinition: ipfs://bafyreifkdekhx2khdpw74hg65kisb7xprznasxhzx6ewbmozdpj7c4u5zq
---
Fetches a [resource](../glossary.md) by its [parsed id](./type/id.md) and returns whichever state it is in: a [document](../protocol/documents.md), a [comment](../protocol/comments.md), a redirect, not found, a tombstone, or an error. [rpc/type/resource](./type/resource.md) lists each state. <!-- id:0FgdDO0r -->

This page describes the **rpc/resource** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:qsZY_yJS -->

# Shape <!-- id:wRYJGS_e -->

A **closed struct** with these fields: <!-- id:utly96z5 -->
  - `key` _(required)_: `"Resource"` <!-- id:UToawi30 -->
  - `input` _(required)_: [rpc/type/id](./type/id.md) <!-- id:FVQ72Tj4 -->
  - `output` _(required)_: [rpc/type/resource](./type/resource.md) <!-- id:-cmT97ah -->

# Depends on <!-- id:jnPQmqvS -->

- [rpc/type/id](./type/id.md) <!-- id:gdMZoKdz -->
- [rpc/type/resource](./type/resource.md) <!-- id:Qt87mW4L -->

# See also <!-- id:aEHTBil6 -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:qbtl_8jA -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:i3wBYXik -->
- [RPC](./method.md): every method in one union. <!-- id:0luRF4qb -->
- [Hypermedia URLs](../protocol/urls.md): the `hm://` URLs that ids come from. <!-- id:Q6jS7Vh1 -->
- [Document (Payload)](./type/document.md): the document read model. <!-- id:TQ1fXNVt -->
- [ResourceMetadata](./resource-metadata.md): fetch only the metadata. <!-- id:p8jtf1g_ -->
