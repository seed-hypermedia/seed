---
name: Raw Capability
summary: A capability as indexed, in raw wire form with every field an optional string.
---
A [capability](../../protocol/permissions.md) as the daemon indexes it, in raw wire form where every field is an optional string. [rpc/list-capabilities](../list-capabilities.md) returns these. <!-- id:S4b_KI-P -->

This page describes the **rpc/type/raw-capability** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:PjpY-Hh8 -->

# See also <!-- id:uDLRb1NV -->

- [Capability (Payload)](./capability.md): the resolved form. <!-- id:p9VKTTsq -->
- [Capability](../../capability.md): the signed capability blob. <!-- id:UhvjafoM -->
- [ListCapabilities](../list-capabilities.md): the method that returns it. <!-- id:gbdf5cLJ -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:ivuWPAmL -->
