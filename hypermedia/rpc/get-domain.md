---
name: "RPC: GetDomain"
summary: "Returns the daemon’s registration and health view of one site domain, optionally forcing a fresh check."
schemaDefinition: ipfs://bafyreigiykbu2fj4zvcvlpdhuwat64atcehxdghv2gsnbt4ioxbdknigoa
---
Checks a site domain's registration and health. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:2l4-eCts -->

This page describes the **rpc/get-domain** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:aJPhKONp -->

# Shape <!-- id:jPvtB3gH -->

A **closed struct** with these fields: <!-- id:SzX-JA_i -->
  - `key` _(required)_: `"GetDomain"` <!-- id:0e_hZB9E -->
  - `input` _(required)_: map { 2 fields } <!-- id:qnrvoO3P -->
  - `output` _(required)_: [rpc/type/domain-info](./type/domain-info.md) <!-- id:2MN5naQ7 -->

# Depends on <!-- id:bs3kYXsk -->

- [boolean](../boolean.md) <!-- id:SUvr718b -->
- [string](../string.md) <!-- id:tc1K4yXu -->
- [rpc/type/domain-info](./type/domain-info.md) <!-- id:R5YpTEY6 -->
