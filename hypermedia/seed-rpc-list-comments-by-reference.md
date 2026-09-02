---
name: "RPC: ListCommentsByReference"
summary: "Lists comments that reference a specific block (the target id carries the blockRef). One method of the Seed universal-client API: `request(key, input) -> output"
schemaDefinition: ipfs://bafyreihx25u4aouxzvwnmgtkg5tidhhvbebdtemmsnom4bfcae3tb42wfu
---
Lists comments that reference a specific block (the target id carries the blockRef). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:Zqcrf57v -->

This document describes the **seed-rpc-list-comments-by-reference** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5eUKh3i5 -->