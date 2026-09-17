---
name: Accounts Metadata
summary: "A map from account uid to resolved metadata payload, sent alongside listings so clients can render authors without extra requests."
schemaDefinition: ipfs://bafyreibeenkjw3vbnedisiwx3l6gex4kbh2ddbi5x7a2kjdq2rbjap7khm
---
A map from [account](../../protocol/identity.md) uid to its resolved [metadata payload](./metadata-payload.md). Listings send it along so clients can show authors without extra requests. <!-- id:ytAJ6HkR -->

This page describes the **rpc/type/accounts-metadata** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:0FrTmY7Y -->

# Shape <!-- id:bBb-OVOx -->

An **open map**. Every value: [rpc/type/metadata-payload](./metadata-payload.md). <!-- id:STXR7Lms -->

# Depends on <!-- id:naBMAOd_ -->

- [rpc/type/metadata-payload](./metadata-payload.md) <!-- id:3J-SED2K -->

# See also

- [Metadata Payload](./metadata-payload.md): each value.
- [Query Block Payload](./query-block-payload.md): a listing that carries it.
- [Collaborators Payload](./collaborators-payload.md): another listing that carries it.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
