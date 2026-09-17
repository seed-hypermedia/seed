---
name: "RPC: ListDomains"
summary: "Returns every site domain the daemon knows, each with its registration and health info."
schemaDefinition: ipfs://bafyreidlmqv7wr7wbybpocgdd2ok5yxgwyu74n35x63fcpjkbdquc3wqka
---
Lists all site domains the daemon knows about. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:EU590VBL -->

This page describes the **rpc/list-domains** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:EUFuDI5u -->

# Shape <!-- id:FQW6uXz3 -->

A **closed struct** with these fields: <!-- id:9151imY0 -->
  - `key` _(required)_: `"ListDomains"` <!-- id:N6se43YX -->
  - `input` _(required)_: map <!-- id:bKAFDwFF -->
  - `output` _(required)_: map { 1 fields } <!-- id:VFyNONl3 -->

# Depends on <!-- id:MHXgMWho -->

- [rpc/type/domain-info](./type/domain-info.md) <!-- id:YRWfuQiw -->
