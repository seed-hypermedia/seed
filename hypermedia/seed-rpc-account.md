---
name: "RPC: Account"
summary: "Resolves an account by uid. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types "
schemaDefinition: ipfs://bafyreidv63ycubu4lxrh6appp4varh7c5a7mqvumektpydnh5qykxz5hle
---
Resolves an account by uid. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:6J7TokxK -->

This document describes the **seed-rpc-account** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ZU4n5PMC -->

# Shape <!-- id:59ehBck9 -->
A **closed struct** with these fields: <!-- id:GaSmj_z8 -->
  - `key` _(required)_ — `string` enum: `Account` <!-- id:XtkZdN5R -->
  - `input` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Hts3kMP5 -->
  - `output` _(required)_ — [seed-account-result](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-account-result) <!-- id:mi5qviZs -->

# Depends on <!-- id:fl4WJGvJ -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:EgZGPF7j -->
- [seed-account-result](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-account-result) <!-- id:ilaQtTDw -->