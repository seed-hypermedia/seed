---
name: "Resource: Tombstone"
summary: A resource that was deleted by a tombstone ref.
---
A [resource](../../glossary.md) that a tombstone [ref](../../ref.md) deleted. It is one state of [rpc/type/resource](./resource.md). <!-- id:9Rg8Ay2p -->

This page describes the **rpc/type/resource-tombstone** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:J9aXyASx -->

# See also <!-- id:V3DgNLzm -->

- [Resource](./resource.md): every resource state. <!-- id:ePLZ6rLj -->
- [Documents](../../protocol/documents.md): tombstones and deletion. <!-- id:CxQE0c_P -->
- [Resource: Not Found](./resource-not-found.md): the not-found state. <!-- id:iOTudtB3 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:Mp-T5i-G -->
