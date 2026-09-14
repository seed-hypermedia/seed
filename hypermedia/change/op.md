---
name: Operation
summary: A single CRDT operation inside a Change body — a discriminated union tagged on type.
schemaDefinition: ipfs://bafyreibbltghnzolwxrv7qrputb6coi2gt2bp2eussog7o6tdbj4io5lgy
---
This document describes the **change/op** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:JsOLI17h -->

# Shape <!-- id:xCLEKTpg -->

A **union** — a value matches one of these variants: <!-- id:bdgSe4Z4 -->
  - [change/op/set-attributes](./op/set-attributes.md) <!-- id:BP_gB1f4 -->
  - [change/op/move-blocks](./op/move-blocks.md) <!-- id:q_WzwIs6 -->
  - [change/op/replace-block](./op/replace-block.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:DPvyep9M -->
  - [change/op/delete-blocks](./op/delete-blocks.md) <!-- id:PlfgegNY -->
  - [change/op/set-key](./op/set-key.md) <!-- id:HKHLdobn -->

**Generic** over `⟨Block⟩` (default [block](../block.md)). <!-- id:VQIfC_d8 -->

# Depends on <!-- id:BTjLtIcz -->

- [block](../block.md) <!-- id:qhL6R4Ju -->
- [change/op/delete-blocks](./op/delete-blocks.md) <!-- id:I7YcxiFi -->
- [change/op/move-blocks](./op/move-blocks.md) <!-- id:QfAw7guU -->
- [change/op/replace-block](./op/replace-block.md) <!-- id:bKH963tB -->
- [change/op/set-attributes](./op/set-attributes.md) <!-- id:xn-9VfDd -->
- [change/op/set-key](./op/set-key.md) <!-- id:HylY6yqt -->
