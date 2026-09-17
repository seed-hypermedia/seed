---
name: Character Stats
summary: "A character’s stats object, stored as its own DAG-CBOR blob linked by `ipfs://` so it can hold the integers and enums document metadata cannot."
schemaDefinition: ipfs://bafyreicqyqbhxuvjyo36z5unngbmtegvzoqm223sbzkxo7l3adkh2sshsy
---
A character's stats object, which a [character](./character-doc.md) page links to from its `stats` field. It lives as its own [DAG-CBOR](../schema/dag-cbor.md) blob behind an [ipfs:// URL](../ipfs-url.md), so it can hold [integers](../integer.md) and enums that document [metadata](../metadata.md) cannot. <!-- id:oHLwcXC5 -->

This page describes the **example/stats** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:qiyJLpb0 -->

# Shape <!-- id:F-O470TV -->

A **closed struct** with these fields: <!-- id:G2YL1Yf3 -->
  - `strength` _(required)_: `integer` (1 to 10) <!-- id:Z9r2yevr -->
  - `intellect` _(required)_: `integer` (1 to 10) <!-- id:VbVkvo-D -->
  - `charisma` _(required)_: `integer` (1 to 10) <!-- id:RKip766b -->
  - `alignment`: [string](../string.md) (one of `lawful`, `neutral`, `chaotic`) <!-- id:yokYx90K -->
  - `traits`: list of [string](../string.md) <!-- id:g0sFEEZM -->

# Depends on <!-- id:gbkbOHZl -->

- [string](../string.md) <!-- id:mX_FWlal -->

# See also

- [character-doc](./character-doc.md): links to a stats object.
- [World Builder](../schema/world-builder.md): the demo these types come from.
- [constrained](./constrained.md): more value constraints.
- [Examples](../example.md): every example, grouped by feature.
