---
name: "RPC: ResourceMetadata"
summary: "Returns only the metadata payload of a resource, given its parsed id."
schemaDefinition: ipfs://bafyreiain6czrhflzyx6v62c6zcbquudbbkdmakxzixktvk5r7qocy5j44
---
Fetches only a resource's metadata payload. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:C2feHa74 -->

This page describes the **rpc/resource-metadata** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:20rKl8KP -->

# Shape <!-- id:_ep6ugnk -->

A **closed struct** with these fields: <!-- id:5AAU-kvD -->
  - `key` _(required)_: `"ResourceMetadata"` <!-- id:HerqY_zj -->
  - `input` _(required)_: [rpc/type/id](./type/id.md) <!-- id:1XN_xHq6 -->
  - `output` _(required)_: [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:EGkLBWqc -->

# Depends on <!-- id:OV283JHj -->

- [rpc/type/id](./type/id.md) <!-- id:_dSHDZrd -->
- [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:x5jQfnso -->
