---
name: "RPC: Account"
summary: "Resolves an account by uid. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types "
schemaDefinition: ipfs://bafyreieu4appjyqcdnzbs2ahzbsjio7whl2xujwu7ttwx65x2qq643b7gm
---
Resolves an account by uid. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:6J7TokxK -->

This document describes the **rpc/account** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ZU4n5PMC -->

# Shape <!-- id:59ehBck9 -->

A **closed struct** with these fields: <!-- id:GaSmj_z8 -->
  - `key` _(required)_ — `"Account"` <!-- id:XtkZdN5R -->
  - `input` _(required)_ — [string](../schema/string.md) <!-- id:Hts3kMP5 -->
  - `output` _(required)_ — [rpc/type/account-result](./type/account-result.md) <!-- id:mi5qviZs -->

# Depends on <!-- id:fl4WJGvJ -->

- [string](../schema/string.md) <!-- id:EgZGPF7j -->
- [rpc/type/account-result](./type/account-result.md) <!-- id:ilaQtTDw -->
