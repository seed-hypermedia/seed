---
name: Search results
summary: A page of search results with the query echoed back and a pagination token. A derived read model computed by the Seed daemon/API for clients — not a signed netw
schemaDefinition: ipfs://bafyreic6j3pzbjngh5pvcnh5u63ng54d55plj2t56xnoscazkl4kytmrhu
---
A page of search results with the query echoed back and a pagination token. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:1JEeVGHU -->

This document describes the **seed-search-results** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:t4EQ4Pea -->

# Shape <!-- id:9ucgCNE3 -->

A **closed struct** with these fields: <!-- id:YHpy0iy7 -->
  - `entities` _(required)_ — list of [seed-search-result-item](./seed-search-result-item.md) <!-- id:KmQctIUf -->
  - `searchQuery` _(required)_ — [string](./hypermedia-string.md) <!-- id:DKVjSdy9 -->
  - `nextPageToken` _(required)_ — [string](./hypermedia-string.md) <!-- id:xIqVZi0C -->

# Depends on <!-- id:3XiUHP7C -->

- [string](./hypermedia-string.md) <!-- id:b9Kfh0VR -->
- [seed-search-result-item](./seed-search-result-item.md) <!-- id:9uDnhRLl -->
