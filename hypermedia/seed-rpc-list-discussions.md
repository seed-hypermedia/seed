---
name: "RPC: ListDiscussions"
summary: Lists threaded discussions on a document (optionally focused on one comment), plus citing discussions from other documents. One method of the Seed universal-cli
schemaDefinition: ipfs://bafyreid3rxqhsnnwbfkaw5wb2l6auobtkkvzcfuyvaqdsgh7uiy74cbqoe
---
Lists threaded discussions on a document (optionally focused on one comment), plus citing discussions from other documents. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:unbh1D7h -->

This document describes the **seed-rpc-list-discussions** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:bvGkwgJy -->