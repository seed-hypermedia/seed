---
name: Collaborators Payload
summary: "A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model comp"
schemaDefinition: ipfs://bafyreiezakrqudlyhovbdrkx3tepcr5pqxqrueydmtfjo5oybiqf3mdvcy
---
A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:qppfw6ji -->

This document describes the **rpc/type/collaborators-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:o_ipNuGi -->

# Shape <!-- id:0pHZWhFV -->

A **closed struct** with these fields: <!-- id:aPWcE-eZ -->
  - `publisherUid` _(required)_ — [string](../../string.md) <!-- id:dNxcOhZ0 -->
  - `parentCapabilities` _(required)_ — list of [rpc/type/capability](./capability.md) <!-- id:1Qe1cDdo -->
  - `grantedCapabilities` _(required)_ — list of [rpc/type/capability](./capability.md) <!-- id:F1LujJDo -->
  - `grantedMembers` _(required)_ — list of [rpc/type/site-member](./site-member.md) <!-- id:MgzEcRK6 -->
  - `members` _(required)_ — list of [rpc/type/site-member](./site-member.md) <!-- id:0jqsG9an -->
  - `accounts` _(required)_ — [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:iTCASGut -->

# Depends on <!-- id:EuNEDEuM -->

- [string](../../string.md) <!-- id:wh5e0WNl -->
- [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:VDls_Pgs -->
- [rpc/type/capability](./capability.md) <!-- id:DNmDsWAi -->
- [rpc/type/site-member](./site-member.md) <!-- id:0RjtWQQY -->
