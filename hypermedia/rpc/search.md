---
name: "RPC: Search"
summary: Searches the network for documents, contacts, and comments matching a query string, with optional account, type, and paging filters.
schemaDefinition: ipfs://bafyreid7sgphydzs3bmydbu6k4r4wv2ewk3qz7macg4o4w2ta56byqznde
---
Searches the network for [documents](../protocol/documents.md), [contacts](../protocol/permissions.md) and [comments](../protocol/comments.md) that match a query string. Optional filters narrow it by account and type and set paging. The result is a page of [search results](./type/search-results.md). <!-- id:6M7UDKGx -->

This page describes the **rpc/search** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:Ua8QFVyl -->

# Shape <!-- id:rNtJKIpN -->

A **closed struct** with these fields: <!-- id:xZHVDSnU -->
  - `key` _(required)_: `"Search"` <!-- id:jyBd_Pa7 -->
  - `input` _(required)_: map { 11 fields } <!-- id:ngg4oBL5 -->
  - `output` _(required)_: [rpc/type/search-results](./type/search-results.md) <!-- id:OlDlHyNJ -->

# Depends on <!-- id:OUtj28Fz -->

- [boolean](../boolean.md) <!-- id:XSL1ytom -->
- [integer](../integer.md) <!-- id:T4EMUh_q -->
- [string](../string.md) <!-- id:pea6QrJ4 -->
- [rpc/type/search-results](./type/search-results.md) <!-- id:oDACMPrv -->

# See also <!-- id:7gRkfW9t -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:M1EUqyTh -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:uhER1Y9O -->
- [RPC](./method.md): every method in one union. <!-- id:NCNZ_BTC -->
- [Search Result Item](./type/search-result-item.md): one hit. <!-- id:I-cN6wSa -->
- [Query](./query.md): structured document queries. <!-- id:YM_Uucgt -->
- [Query grammar](../build/query-grammar.md): attribute queries. <!-- id:IjTMa_HE -->
