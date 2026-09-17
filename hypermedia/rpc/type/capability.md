---
name: Capability (Payload)
summary: "A capability as the API returns it: who was granted which role on which grant id."
schemaDefinition: ipfs://bafyreigizt5muz7rep5xyran5tbhzkj7ag563edhd6c73xrka5e76u4vfi
---
A [capability](../../protocol/permissions.md) as the API returns it: who was granted which [role](../../role.md) on which grant id. The signed blob is [capability](../../capability.md). <!-- id:07W6OLh9 -->

This page describes the **rpc/type/capability** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:muCOPBV1 -->

# Shape <!-- id:U635-Zyt -->

A **closed struct** with these fields: <!-- id:9qhgoTmA -->
  - `id` _(required)_: [string](../../string.md) <!-- id:p0Pqs-hQ -->
  - `accountUid` _(required)_: [string](../../string.md) <!-- id:3FK_99NA -->
  - `role` _(required)_: [role](../../role.md) <!-- id:9j3W7BSF -->
  - `capabilityId`: [string](../../string.md) <!-- id:jGkFhD5o -->
  - `grantId` _(required)_: [rpc/type/id](./id.md) <!-- id:kw33mNHc -->
  - `label`: [string](../../string.md) <!-- id:mit3zxzN -->
  - `createTime` _(required)_: [timestamp](../../timestamp.md) <!-- id:fOzDuCtH -->

# Depends on <!-- id:Thx5b8sf -->

- [role](../../role.md) <!-- id:L2yWRuzu -->
- [timestamp](../../timestamp.md) <!-- id:3XGFsdz3 -->
- [string](../../string.md) <!-- id:6MwjyTWx -->
- [rpc/type/id](./id.md) <!-- id:RiWTRYEb -->

# See also

- [Permissions](../../protocol/permissions.md): capabilities, roles and delegation.
- [Raw Capability](./raw-capability.md): the indexed wire form.
- [Collaborators Payload](./collaborators-payload.md): where the API returns these.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
