---
name: Capability (payload)
summary: "A capability as the API returns it: who was granted which role on which grant id. A derived read model computed by the Seed daemon/API for clients — not a signe"
schemaDefinition: ipfs://bafyreies4pkfd3nv2urvzu5q7i4ufbcysdh2q3tiwyrxs6hqbiojs4t4qy
---
A capability as the API returns it: who was granted which role on which grant id. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:07W6OLh9 -->

This document describes the **seed-capability** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:muCOPBV1 -->

# Shape <!-- id:U635-Zyt -->

A **closed struct** with these fields: <!-- id:9qhgoTmA -->
  - `id` _(required)_ — [string](./onyx-string.md) <!-- id:p0Pqs-hQ -->
  - `accountUid` _(required)_ — [string](./onyx-string.md) <!-- id:3FK_99NA -->
  - `role` _(required)_ — [hypermedia-role](./hypermedia-role.md) <!-- id:9j3W7BSF -->
  - `capabilityId` — [string](./onyx-string.md) <!-- id:jGkFhD5o -->
  - `grantId` _(required)_ — [seed-id](./seed-id.md) <!-- id:kw33mNHc -->
  - `label` — [string](./onyx-string.md) <!-- id:mit3zxzN -->
  - `createTime` _(required)_ — [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:fOzDuCtH -->

# Depends on <!-- id:Thx5b8sf -->

- [hypermedia-role](./hypermedia-role.md) <!-- id:L2yWRuzu -->
- [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:3XGFsdz3 -->
- [string](./onyx-string.md) <!-- id:6MwjyTWx -->
- [seed-id](./seed-id.md) <!-- id:RiWTRYEb -->
