---
name: Accounts Metadata
summary: Account uid -> resolved metadata payload, sent alongside listings so clients can render authors without extra requests. A derived read model computed by the See
schemaDefinition: ipfs://bafyreia3yvkl36mbcjg7krn56lrqs2gssh2fd4f52zcfpgugo7xtef6mjy
---
Account uid -> resolved metadata payload, sent alongside listings so clients can render authors without extra requests. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ytAJ6HkR -->

This document describes the **rpc/type/accounts-metadata** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:0FrTmY7Y -->

# Shape <!-- id:bBb-OVOx -->

An **open map** — every value: [rpc/type/metadata-payload](./metadata-payload.md). <!-- id:STXR7Lms -->

# Depends on <!-- id:naBMAOd_ -->

- [rpc/type/metadata-payload](./metadata-payload.md) <!-- id:3J-SED2K -->
