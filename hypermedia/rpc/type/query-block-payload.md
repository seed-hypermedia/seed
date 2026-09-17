---
name: Query Block Payload
summary: "Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata."
schemaDefinition: ipfs://bafyreifro57tpsh3sbgg7u6vbc52j727ygpnlhathvnvzhsxuqqvwskqki
---
Everything a rendered [query block](../../protocol/blocks.md) needs: the [results](./document-info.md), per-item [interaction summaries](./query-block-item-summary.md) and author metadata. [rpc/query-block](../query-block.md) returns it. <!-- id:VzSZH5xA -->

This page describes the **rpc/type/query-block-payload** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:OsEQqtxV -->

# Shape <!-- id:a4jQ1u0u -->

A **closed struct** with these fields: <!-- id:DyS_qKTz -->
  - `queryTargetName` _(required)_: [string](../../string.md) <!-- id:lpgzgCDx -->
  - `in` _(required)_: [rpc/type/id](./id.md) <!-- id:PaNXccq8 -->
  - `results` _(required)_: list of [rpc/type/document-info](./document-info.md) <!-- id:pqVQymXu -->
  - `mode`: one of `"Children"` | `"AllDescendants"` <!-- id:HKi67-Wj -->
  - `interactionSummaries` _(required)_: map ⟨ \* : [rpc/type/query-block-item-summary](./query-block-item-summary.md) ⟩ <!-- id:EqpWvaWn -->
  - `accountsMetadata` _(required)_: [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:UpOdUnhj -->

# Depends on <!-- id:ooVpqrDK -->

- [string](../../string.md) <!-- id:z5cuCUEY -->
- [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:J1qY7Tl5 -->
- [rpc/type/document-info](./document-info.md) <!-- id:IBffstpK -->
- [rpc/type/id](./id.md) <!-- id:VjUau-KS -->
- [rpc/type/query-block-item-summary](./query-block-item-summary.md) <!-- id:3DKOCjfE -->

# See also <!-- id:wm9hJK_g -->

- [QueryBlock](../query-block.md): the method that returns it. <!-- id:XL1_YyB3 -->
- [Query Result](./query-result.md): the results without the extras. <!-- id:ElQjd1_p -->
- [Accounts Metadata](./accounts-metadata.md): the author metadata. <!-- id:SGFlOQQo -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:bJOG3Px4 -->
