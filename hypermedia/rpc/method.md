---
name: RPC
summary: The union of every read-only method of the Seed API, each variant pinning a method key and typing its input and output.
---
The union of every read-only method of the [Seed API](../build/web-api.md). Each variant pins a method key and types its input and output. The app's [API console](../rpc.md) builds its method picker from this union. <!-- id:IKHnPUjW -->

This page describes the **rpc/method** union. Each method's output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:fcTIA-2I -->

# See also <!-- id:WY60lqm- -->

- [Seed API Schemas](../rpc.md): how the methods are published and the console. <!-- id:Eh4B2bQE -->
- [Seed API](../build/web-api.md): calling these keys over HTTP. <!-- id:iPUozo1L -->
- [SDK](../build/sdk.md): typed calls from TypeScript. <!-- id:kfjbyoNo -->
- [Resource](./resource.md): the most common read. <!-- id:tWF0cW-d -->
- [Search](./search.md): full-text search. <!-- id:d9IB0Vla -->
