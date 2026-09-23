---
name: "RPC: InteractionSummary"
summary: Returns a document’s aggregate citation, comment, change, child, and author counts with per-block breakdowns, given its id.
---
Counts the interactions on a [document](../protocol/documents.md): [citations](../protocol/comments.md), comments, changes, child documents and authors, with counts per [block](../protocol/blocks.md). The result is an [interaction summary](./type/interaction-summary.md). <!-- id:o5tltrJQ -->

This page describes the **rpc/interaction-summary** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:1AAby3IV -->

# See also <!-- id:fR9a7ajC -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:XplM3uAk -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:TQzIkpb4 -->
- [RPC](./method.md): every method in one union. <!-- id:KRryWyiP -->
- [Comments](../protocol/comments.md): comments and citations. <!-- id:PcAdRU2b -->
- [ListCitations](./list-citations.md): the citations behind the count. <!-- id:drnrwjlu -->
- [ListComments](./list-comments.md): the comments behind the count. <!-- id:mVKHa0Ki -->
