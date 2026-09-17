---
name: Account Result
summary: "The result of resolving an account: its metadata payload, or an explicit not-found."
schemaDefinition: ipfs://bafyreics6pps7x7d75xdcf77lugyahm2zqkg7dqwahzvlxatbtglnag5fq
---
The result of resolving an account: its metadata payload, or an explicit not-found. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:cQGLYho_ -->

This page describes the **rpc/type/account-result** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:ZMdfA4H5 -->

# Shape <!-- id:GzEze6Bq -->

A **union** — a value matches one of these variants: <!-- id:HZf6WBQs -->
  - map { 4 fields } <!-- id:f267j-6y -->
  - map { 2 fields } <!-- id:RRWidmry -->

# Depends on <!-- id:H_xarqfm -->

- [metadata](../../metadata.md) <!-- id:ht4dyEW_ -->
- [boolean](../../boolean.md) <!-- id:dq0xPHDe -->
- [null](../../null.md) <!-- id:aTp6vL1V -->
- [string](../../string.md) <!-- id:BvamZwgP -->
- [rpc/type/id](./id.md) <!-- id:-A7na0uO -->
