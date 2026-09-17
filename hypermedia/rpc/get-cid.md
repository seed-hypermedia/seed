---
name: "RPC: GetCID"
summary: "Fetches a raw IPFS block by CID and returns it decoded as a DAG-JSON value."
schemaDefinition: ipfs://bafyreic5sb7xm2eidzvnu2ghffcybycqx5o6vynbfbtaboxlchiwhjfrfm
---
Fetches a raw IPFS block by CID and decodes it. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:KrdeFkDA -->

This page describes the **rpc/get-cid** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:rPC2zBYZ -->

# Shape <!-- id:0EwBrMzm -->

A **closed struct** with these fields: <!-- id:HzFHBpWO -->
  - `key` _(required)_ — `"GetCID"` <!-- id:ZJCBLccu -->
  - `input` _(required)_ — map { 1 fields } <!-- id:AF0I_I1D -->
  - `output` _(required)_ — map { 1 fields } <!-- id:ERIh36-p -->

# Depends on <!-- id:ardnz0nd -->

- [any](../any.md) <!-- id:xxcRpn4k -->
- [string](../string.md) <!-- id:rLVe6evY -->
