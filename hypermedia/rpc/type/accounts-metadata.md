---
name: Accounts Metadata
summary: "A map from account uid to resolved metadata payload, sent alongside listings so clients can render authors without extra requests."
schemaDefinition: ipfs://bafyreibeenkjw3vbnedisiwx3l6gex4kbh2ddbi5x7a2kjdq2rbjap7khm
---
Account uid -> resolved metadata payload, sent alongside listings so clients can render authors without extra requests. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ytAJ6HkR -->

This page describes the **rpc/type/accounts-metadata** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:0FrTmY7Y -->

# Shape <!-- id:bBb-OVOx -->

An **open map** — every value: [rpc/type/metadata-payload](./metadata-payload.md). <!-- id:STXR7Lms -->

# Depends on <!-- id:naBMAOd_ -->

- [rpc/type/metadata-payload](./metadata-payload.md) <!-- id:3J-SED2K -->
