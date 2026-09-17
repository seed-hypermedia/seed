---
name: "RPC: GetCID"
summary: "Fetches a raw IPFS block by CID and returns it decoded as a DAG-JSON value."
schemaDefinition: ipfs://bafyreic5sb7xm2eidzvnu2ghffcybycqx5o6vynbfbtaboxlchiwhjfrfm
---
Fetches a raw IPFS block by [CID](../protocol/blobs.md) and returns it decoded as a [DAG-JSON](../schema/dag-json.md) value. <!-- id:KrdeFkDA -->

This page describes the **rpc/get-cid** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is the stored block itself, decoded, so it can be any blob on the network, signed or not. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:rPC2zBYZ -->

# Shape <!-- id:0EwBrMzm -->

A **closed struct** with these fields: <!-- id:HzFHBpWO -->
  - `key` _(required)_: `"GetCID"` <!-- id:ZJCBLccu -->
  - `input` _(required)_: map { 1 fields } <!-- id:AF0I_I1D -->
  - `output` _(required)_: map { 1 fields } <!-- id:ERIh36-p -->

# Depends on <!-- id:ardnz0nd -->

- [any](../any.md) <!-- id:xxcRpn4k -->
- [string](../string.md) <!-- id:rLVe6evY -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Signed Blobs](../protocol/blobs.md): encoding and content addressing.
- [CID](../cid.md): the CID type.
- [Files](../protocol/files.md): files and the `/ipfs/` endpoint.
