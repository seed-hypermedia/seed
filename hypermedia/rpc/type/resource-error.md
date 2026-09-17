---
name: "Resource: Error"
summary: A resource that failed to load, carrying its id and the error message.
---
A [resource](../../glossary.md) that failed to load, with its [parsed id](./id.md) and the error message. It is one state of [rpc/type/resource](./resource.md). <!-- id:zF8-G8xR -->

This page describes the **rpc/type/resource-error** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:GZqGZhzd -->

# See also <!-- id:D7ZmhUUd -->

- [Resource](./resource.md): every resource state. <!-- id:6nxNkfAT -->
- [Resource: Not Found](./resource-not-found.md): the not-found state. <!-- id:TgHVfpc3 -->
- [Seed API](../../build/web-api.md): errors at the HTTP level. <!-- id:9m5ZIN9c -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:9hcvkpIx -->
