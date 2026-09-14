---
name: Account Result
summary: "The result of resolving an account: its metadata payload, or an explicit not-found. A derived read model computed by the Seed daemon/API for clients — not a sig"
schemaDefinition: ipfs://bafyreiboqfndgauvtszjcv5nx47auwk5335z7ezkwpmz5ic3yyttmnub2q
---
The result of resolving an account: its metadata payload, or an explicit not-found. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:cQGLYho_ -->

This document describes the **rpc/type/account-result** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ZMdfA4H5 -->

# Shape <!-- id:GzEze6Bq -->

A **union** — a value matches one of these variants: <!-- id:HZf6WBQs -->
  - map { 4 fields } <!-- id:f267j-6y -->
  - map { 2 fields } <!-- id:RRWidmry -->

# Depends on <!-- id:H_xarqfm -->

- [metadata](../../metadata.md) <!-- id:ht4dyEW_ -->
- [boolean](../../schema/boolean.md) <!-- id:dq0xPHDe -->
- [null](../../schema/null.md) <!-- id:aTp6vL1V -->
- [string](../../schema/string.md) <!-- id:BvamZwgP -->
- [rpc/type/id](./id.md) <!-- id:-A7na0uO -->
