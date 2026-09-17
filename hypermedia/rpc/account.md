---
name: "RPC: Account"
summary: "Resolves an account uid to its metadata payload, or to an explicit not-found result."
schemaDefinition: ipfs://bafyreia7idjrnvfoy2fy676lzxjlza46egtlkozyeabr6c62detwkml5hq
---
Resolves an account by uid. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:6J7TokxK -->

This page describes the **rpc/account** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:ZU4n5PMC -->

# Shape <!-- id:59ehBck9 -->

A **closed struct** with these fields: <!-- id:GaSmj_z8 -->
  - `key` _(required)_: `"Account"` <!-- id:XtkZdN5R -->
  - `input` _(required)_: [string](../string.md) <!-- id:Hts3kMP5 -->
  - `output` _(required)_: [rpc/type/account-result](./type/account-result.md) <!-- id:mi5qviZs -->

# Depends on <!-- id:fl4WJGvJ -->

- [string](../string.md) <!-- id:EgZGPF7j -->
- [rpc/type/account-result](./type/account-result.md) <!-- id:ilaQtTDw -->
