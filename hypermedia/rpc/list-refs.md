---
name: "RPC: ListRefs"
summary: Returns every Ref published at a document path, newest generation first, given the target id.
---
Lists every [Ref](../ref.md) published at one path of a space, given its id: the current one and all the earlier ones it replaced, newest generation first. Each one comes back as a [raw Ref](./type/raw-ref.md). A redirect at the path is listed as a redirect, not followed. `seed-cli space archive --format blobs` uses it to put each document's Refs in the archive.

This page describes the **rpc/list-refs** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md).

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Ref](../ref.md): the signed Ref blob.
- [ListChanges](./list-changes.md): the changes a document's current version is made of.
