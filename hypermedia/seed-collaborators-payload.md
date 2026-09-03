---
name: Collaborators payload
summary: "A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model comp"
schemaDefinition: ipfs://bafyreichyi4ytfxx7rkd3h3jrcz7ie7uh7g53qwdtjkqif6llio4wd7sqq
---
A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:qppfw6ji -->

This document describes the **seed-collaborators-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:o_ipNuGi -->

# Shape <!-- id:0pHZWhFV -->

A **closed struct** with these fields: <!-- id:aPWcE-eZ -->
  - `publisherUid` _(required)_ — [string](./onyx-string.md) <!-- id:dNxcOhZ0 -->
  - `parentCapabilities` _(required)_ — list of [seed-capability](./seed-capability.md) <!-- id:1Qe1cDdo -->
  - `grantedCapabilities` _(required)_ — list of [seed-capability](./seed-capability.md) <!-- id:F1LujJDo -->
  - `grantedMembers` _(required)_ — list of [seed-site-member](./seed-site-member.md) <!-- id:MgzEcRK6 -->
  - `members` _(required)_ — list of [seed-site-member](./seed-site-member.md) <!-- id:0jqsG9an -->
  - `accounts` _(required)_ — [seed-accounts-metadata](./seed-accounts-metadata.md) <!-- id:iTCASGut -->

# Depends on <!-- id:EuNEDEuM -->

- [string](./onyx-string.md) <!-- id:wh5e0WNl -->
- [seed-accounts-metadata](./seed-accounts-metadata.md) <!-- id:VDls_Pgs -->
- [seed-capability](./seed-capability.md) <!-- id:DNmDsWAi -->
- [seed-site-member](./seed-site-member.md) <!-- id:0RjtWQQY -->
