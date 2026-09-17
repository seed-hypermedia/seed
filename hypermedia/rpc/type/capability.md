---
name: Capability (Payload)
summary: "A capability as the API returns it: who was granted which role on which grant id."
---
A [capability](../../protocol/permissions.md) as the API returns it: who was granted which [role](../../role.md) on which grant id. The signed blob is [capability](../../capability.md). <!-- id:07W6OLh9 -->

This page describes the **rpc/type/capability** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:muCOPBV1 -->

# See also <!-- id:xGH2VWqh -->

- [Permissions](../../protocol/permissions.md): capabilities, roles and delegation. <!-- id:A1I7pZGp -->
- [Raw Capability](./raw-capability.md): the indexed wire form. <!-- id:YH7a9T8a -->
- [Collaborators Payload](./collaborators-payload.md): where the API returns these. <!-- id:91n3gJ1f -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:7wtBis_q -->
