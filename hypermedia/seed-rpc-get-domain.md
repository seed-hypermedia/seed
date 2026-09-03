---
name: "RPC: GetDomain"
summary: "Checks a site domain's registration and health. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you p"
schemaDefinition: ipfs://bafyreidh76vbfke6mablrcexmkrtiva7sxadgxxotp3om33es66chqnpmy
---
Checks a site domain's registration and health. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:2l4-eCts -->

This document describes the **seed-rpc-get-domain** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:aJPhKONp -->

# Shape <!-- id:jPvtB3gH -->

A **closed struct** with these fields: <!-- id:SzX-JA_i -->
  - `key` _(required)_ — `string` enum: `GetDomain` <!-- id:0e_hZB9E -->
  - `input` _(required)_ — map { 2 fields } <!-- id:qnrvoO3P -->
  - `output` _(required)_ — [seed-domain-info](./seed-domain-info.md) <!-- id:2MN5naQ7 -->

# Depends on <!-- id:bs3kYXsk -->

- [boolean](./onyx-boolean.md) <!-- id:SUvr718b -->
- [string](./onyx-string.md) <!-- id:tc1K4yXu -->
- [seed-domain-info](./seed-domain-info.md) <!-- id:R5YpTEY6 -->
