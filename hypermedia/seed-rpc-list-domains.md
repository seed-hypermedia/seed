---
name: "RPC: ListDomains"
summary: "Lists all site domains the daemon knows about. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pa"
schemaDefinition: ipfs://bafyreihcgqjezgocontusbpefz4s7ddey326ajsjawmvbg5ncggd6jxom4
---
Lists all site domains the daemon knows about. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:EU590VBL -->

This document describes the **seed-rpc-list-domains** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EUFuDI5u -->

# Shape <!-- id:FQW6uXz3 -->

A **closed struct** with these fields: <!-- id:9151imY0 -->
  - `key` _(required)_ — `string` enum: `ListDomains` <!-- id:N6se43YX -->
  - `input` _(required)_ — map <!-- id:bKAFDwFF -->
  - `output` _(required)_ — map { 1 fields } <!-- id:VFyNONl3 -->

# Depends on <!-- id:MHXgMWho -->

- [seed-domain-info](./seed-domain-info.md) <!-- id:YRWfuQiw -->
