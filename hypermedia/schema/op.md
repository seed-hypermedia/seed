---
name: Operation
summary: A single CRDT operation inside a Change body — a discriminated union tagged on type.
schemaDefinition: ipfs://bafyreifbp4cby57dusqktbrtu3wuxjnuiscsomddqsdpvavfapexzydqn4
---
This document describes the **schema/op** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:JsOLI17h -->

# Shape <!-- id:xCLEKTpg -->

A **union** — a value matches one of these variants: <!-- id:bdgSe4Z4 -->
  - [schema/op/set-attributes](./op/set-attributes.md) <!-- id:BP_gB1f4 -->
  - [schema/op/move-blocks](./op/move-blocks.md) <!-- id:q_WzwIs6 -->
  - [schema/op/replace-block](./op/replace-block.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:DPvyep9M -->
  - [schema/op/delete-blocks](./op/delete-blocks.md) <!-- id:PlfgegNY -->
  - [schema/op/set-key](./op/set-key.md) <!-- id:HKHLdobn -->

**Generic** over `⟨Block⟩` (default [block](../block.md)). <!-- id:VQIfC_d8 -->

# Depends on <!-- id:BTjLtIcz -->

- [block](../block.md) <!-- id:qhL6R4Ju -->
- [schema/op/delete-blocks](./op/delete-blocks.md) <!-- id:I7YcxiFi -->
- [schema/op/move-blocks](./op/move-blocks.md) <!-- id:QfAw7guU -->
- [schema/op/replace-block](./op/replace-block.md) <!-- id:bKH963tB -->
- [schema/op/set-attributes](./op/set-attributes.md) <!-- id:xn-9VfDd -->
- [schema/op/set-key](./op/set-key.md) <!-- id:HylY6yqt -->
