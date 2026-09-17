---
name: "RPC: InteractionSummary"
summary: "Returns a document’s aggregate citation, comment, change, child, and author counts with per-block breakdowns, given its id."
schemaDefinition: ipfs://bafyreidvcyspkzgvc3ceo43cukt7xtjfk7pjkgrkmxtsbn3joytya2uuqu
---
Counts the interactions on a [document](../protocol/documents.md): [citations](../protocol/comments.md), comments, changes, child documents and authors, with counts per [block](../protocol/blocks.md). The result is an [interaction summary](./type/interaction-summary.md). <!-- id:o5tltrJQ -->

This page describes the **rpc/interaction-summary** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:1AAby3IV -->

# Shape <!-- id:_jdaQjrs -->

A **closed struct** with these fields: <!-- id:C6ObWmqI -->
  - `key` _(required)_: `"InteractionSummary"` <!-- id:jeZVsYXW -->
  - `input` _(required)_: map { 1 fields } <!-- id:8lSMzs7Y -->
  - `output` _(required)_: [rpc/type/interaction-summary](./type/interaction-summary.md) <!-- id:atPqOBD3 -->

# Depends on <!-- id:UaUlHKko -->

- [rpc/type/id](./type/id.md) <!-- id:IvcbCWto -->
- [rpc/type/interaction-summary](./type/interaction-summary.md) <!-- id:EIwlmCUh -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Comments](../protocol/comments.md): comments and citations.
- [ListCitations](./list-citations.md): the citations behind the count.
- [ListComments](./list-comments.md): the comments behind the count.
