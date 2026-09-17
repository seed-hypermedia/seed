---
name: Interaction Summary
summary: Aggregate interaction counts for a document (citations, comments, changes, child documents, distinct authors) plus per-block citation and comment counts.
schemaDefinition: ipfs://bafyreic74wynhdjiz5r7ib6sesywlg34hs4fv33g65n5qj6ugh4ibyld6q
---
Counts of the interactions on a [document](../../protocol/documents.md): [citations](../../protocol/comments.md), comments, changes, child documents and distinct authors. It adds citation and comment counts per [block](../../protocol/blocks.md). <!-- id:PWw560Ku -->

This page describes the **rpc/type/interaction-summary** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:Pz9XkamM -->

# Shape <!-- id:P_kmfRIz -->

A **closed struct** with these fields: <!-- id:ErHfF34X -->
  - `citations` _(required)_: `integer` <!-- id:2_8ldqeJ -->
  - `comments` _(required)_: `integer` <!-- id:-x9xLFCo -->
  - `changes` _(required)_: `integer` <!-- id:Mi6241x6 -->
  - `children` _(required)_: `integer` <!-- id:trlRp_lK -->
  - `authorUids`: list of [string](../../string.md) <!-- id:tQurr8ya -->
  - `blocks` _(required)_: map ⟨ \* : map { 2 fields } ⟩ <!-- id:-FgTqWtB -->

# Depends on <!-- id:a54ycyYA -->

- [string](../../string.md) <!-- id:dBRMpu1a -->

# See also <!-- id:V0O-0c9R -->

- [InteractionSummary](../interaction-summary.md): the method that returns it. <!-- id:LXdoyIdk -->
- [Query Block Item Summary](./query-block-item-summary.md): the smaller summary on query block cards. <!-- id:DS2ndCw6 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:lLcwj1QP -->
