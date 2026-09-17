---
name: Raw Ref
summary: A Ref as indexed, in raw wire form, pointing at a version, a redirect or a tombstone.
---
A [Ref](../../ref.md) as the daemon indexes it, in raw wire form where every field is optional. Its `target` holds exactly one of `version` (genesis and head changes), `redirect` (another account and path) or `tombstone` (the path was deleted). [rpc/list-refs](../list-refs.md) returns these.

This page describes the **rpc/type/raw-ref** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it.

# See also

- [Ref](../../ref.md): the signed Ref blob.
- [ListRefs](../list-refs.md): the method that returns it.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
