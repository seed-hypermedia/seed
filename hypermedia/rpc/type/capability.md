---
name: Capability (Payload)
summary: "A capability as the API returns it: who was granted which role on which grant id. A derived read model computed by the Seed daemon/API for clients — not a signe"
schemaDefinition: ipfs://bafyreidk7fo3lrroqrvnmhp5kzusbyh6ulnqx7foahkktu7caidjxz7i3e
---
A capability as the API returns it: who was granted which role on which grant id. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:07W6OLh9 -->

This document describes the **rpc/type/capability** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:muCOPBV1 -->

# Shape <!-- id:U635-Zyt -->

A **closed struct** with these fields: <!-- id:9qhgoTmA -->
  - `id` _(required)_ — [string](../../string.md) <!-- id:p0Pqs-hQ -->
  - `accountUid` _(required)_ — [string](../../string.md) <!-- id:3FK_99NA -->
  - `role` _(required)_ — [role](../../role.md) <!-- id:9j3W7BSF -->
  - `capabilityId` — [string](../../string.md) <!-- id:jGkFhD5o -->
  - `grantId` _(required)_ — [rpc/type/id](./id.md) <!-- id:kw33mNHc -->
  - `label` — [string](../../string.md) <!-- id:mit3zxzN -->
  - `createTime` _(required)_ — [timestamp](../../timestamp.md) <!-- id:fOzDuCtH -->

# Depends on <!-- id:Thx5b8sf -->

- [role](../../role.md) <!-- id:L2yWRuzu -->
- [timestamp](../../timestamp.md) <!-- id:3XGFsdz3 -->
- [string](../../string.md) <!-- id:6MwjyTWx -->
- [rpc/type/id](./id.md) <!-- id:RiWTRYEb -->
