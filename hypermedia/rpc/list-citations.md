---
name: "RPC: ListCitations"
summary: Returns the raw citations that point at a target resource, given its id.
schemaDefinition: ipfs://bafyreifzwfbmojtf5olopsupja2q5pbvavnjmbgakhsefyuyqcsnfiwyye
---
Lists the raw [citations](../protocol/comments.md) that point at a target resource, given its id. Each one is a [raw citation](./type/raw-citation.md). <!-- id:EWDwlcgM -->

This page describes the **rpc/list-citations** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:4clN1Gbd -->

# Shape <!-- id:z2qy10O8 -->

A **closed struct** with these fields: <!-- id:DCfHjHME -->
  - `key` _(required)_: `"ListCitations"` <!-- id:kLPa7FFC -->
  - `input` _(required)_: map { 1 fields } <!-- id:764R8Zt5 -->
  - `output` _(required)_: map { 1 fields } <!-- id:q3KgSdY9 -->

# Depends on <!-- id:Wk6DpqCs -->

- [rpc/type/id](./type/id.md) <!-- id:iS-6L-Uf -->
- [rpc/type/raw-citation](./type/raw-citation.md) <!-- id:Umt7r3Gz -->

# See also <!-- id:VepTxBNO -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:7m11S0MH -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:isEjti8a -->
- [RPC](./method.md): every method in one union. <!-- id:bxKOyCuy -->
- [Comments](../protocol/comments.md): citations, mentions and backlinks. <!-- id:RTX7fFYH -->
- [Citation](./type/citation.md): the resolved citation shape. <!-- id:fVRqK4aa -->
- [InteractionSummary](./interaction-summary.md): citation counts. <!-- id:gTBrnCtz -->
