---
name: Search Results
summary: A page of search results with the query echoed back and a token for the next page.
---
A page of [search results](./search-result-item.md) with the query echoed back and a token for the next page. [rpc/search](../search.md) returns it. <!-- id:1JEeVGHU -->

This page describes the **rpc/type/search-results** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:t4EQ4Pea -->

# See also <!-- id:nTBStvma -->

- [Search](../search.md): the method that returns it. <!-- id:u0tL2hPN -->
- [Search Result Item](./search-result-item.md): one hit. <!-- id:SouBuMWC -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:tyP0eHxS -->
