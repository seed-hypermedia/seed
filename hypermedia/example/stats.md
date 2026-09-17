---
name: Character Stats
summary: A character’s stats object, stored as its own DAG-CBOR blob linked by `ipfs://` so it can hold the integers and enums document metadata cannot.
---
A character's stats object, which a [character](./character-doc.md) page links to from its `stats` field. It lives as its own [DAG-CBOR](../schema/dag-cbor.md) blob behind an [ipfs:// URL](../ipfs-url.md), so it can hold [integers](../integer.md) and enums that document [metadata](../metadata.md) cannot. <!-- id:oHLwcXC5 -->

This page describes the **example/stats** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:qiyJLpb0 -->

# See also <!-- id:TKF_p0Id -->

- [character-doc](./character-doc.md): links to a stats object. <!-- id:lBafi7P6 -->
- [World Builder](../schema/world-builder.md): the demo these types come from. <!-- id:-VFG0CDL -->
- [constrained](./constrained.md): more value constraints. <!-- id:naxIhafE -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:5t0etgiD -->
