---
name: Block Range
summary: A selection within a block, either as character offsets (start and end) or as the whole block expanded.
schemaDefinition: ipfs://bafyreigyopiiv7gs5tnho7yblsi3bhm2lexmgd4jtby6vh5gzshuimsnn4
---
A selection within a [block](../../protocol/blocks.md): character offsets in `start` and `end`, or the whole block expanded. A [parsed id](./id.md) carries one for a [block reference](../../protocol/urls.md). <!-- id:cbPv3bBq -->

This page describes the **rpc/type/block-range** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:bzJECgs2 -->

# Shape <!-- id:_ySLGKVQ -->

A **closed struct** with these fields: <!-- id:N88QDkke -->
  - `start`: `integer` <!-- id:sZD7rgCl -->
  - `end`: `integer` <!-- id:sqGFTb5g -->
  - `expanded`: [boolean](../../boolean.md) <!-- id:uWwInii1 -->

# Depends on <!-- id:JTmQ38m4 -->

- [boolean](../../boolean.md) <!-- id:-9DkLtVZ -->

# See also <!-- id:_SxTa0Jo -->

- [Parsed Fragment](./parsed-fragment.md): a block id plus a range. <!-- id:EtcxGg6p -->
- [Parsed ID](./id.md): the id that carries it. <!-- id:loKqAiDE -->
- [Hypermedia URLs](../../protocol/urls.md): block references and text ranges. <!-- id:tyrdLYF4 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:UFYHTij7 -->
