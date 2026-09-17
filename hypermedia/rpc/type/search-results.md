---
name: Search Results
summary: "A page of search results with the query echoed back and a token for the next page."
schemaDefinition: ipfs://bafyreigmfkfowfjqtpcj3zoisufdjekcd3oui47v3vke3zmydsggk2y7xm
---
A page of search results with the query echoed back and a pagination token. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:1JEeVGHU -->

This page describes the **rpc/type/search-results** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:t4EQ4Pea -->

# Shape <!-- id:9ucgCNE3 -->

A **closed struct** with these fields: <!-- id:YHpy0iy7 -->
  - `entities` _(required)_: list of [rpc/type/search-result-item](./search-result-item.md) <!-- id:KmQctIUf -->
  - `searchQuery` _(required)_: [string](../../string.md) <!-- id:DKVjSdy9 -->
  - `nextPageToken` _(required)_: [string](../../string.md) <!-- id:xIqVZi0C -->

# Depends on <!-- id:3XiUHP7C -->

- [string](../../string.md) <!-- id:b9Kfh0VR -->
- [rpc/type/search-result-item](./search-result-item.md) <!-- id:9uDnhRLl -->
