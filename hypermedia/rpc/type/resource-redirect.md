---
name: "Resource: Redirect"
summary: A resource that redirects to another id, optionally republishing its content in place.
---
A [resource](../../glossary.md) that redirects to another id, optionally republishing its content in place. [Documents](../../protocol/documents.md) explains redirects. It is one state of [rpc/type/resource](./resource.md). <!-- id:nq0tvFEY -->

This page describes the **rpc/type/resource-redirect** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:b0-_bSKN -->

# See also <!-- id:h6BVN1At -->

- [Resource](./resource.md): every resource state. <!-- id:VWCjO2Rb -->
- [Redirect Info](./redirect-info.md): the redirect marker on listings. <!-- id:S7VESAAj -->
- [Ref](../../ref.md): the signed ref that carries a redirect. <!-- id:zB5UvC-b -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:b3SdNfGx -->
