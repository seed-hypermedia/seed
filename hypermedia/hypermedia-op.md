---
name: Operation
summary: A single CRDT operation inside a Change body — a discriminated union tagged on type.
schemaDefinition: ipfs://bafyreihq3o6pih37ge7vmjz653w4xvuutuky44ults3rpqyyvl4jfur5tu
---
This document describes the **hypermedia-op** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:JsOLI17h -->

# Shape <!-- id:xCLEKTpg -->

A **union** — a value matches one of these variants: <!-- id:bdgSe4Z4 -->
  - [hypermedia-op-set-attributes](./hypermedia-op-set-attributes.md) <!-- id:BP_gB1f4 -->
  - [hypermedia-op-move-blocks](./hypermedia-op-move-blocks.md) <!-- id:q_WzwIs6 -->
  - [hypermedia-op-replace-block](./hypermedia-op-replace-block.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:DPvyep9M -->
  - [hypermedia-op-delete-blocks](./hypermedia-op-delete-blocks.md) <!-- id:PlfgegNY -->
  - [hypermedia-op-set-key](./hypermedia-op-set-key.md) <!-- id:HKHLdobn -->

**Generic** over `⟨Block⟩` (default [hypermedia-block](./hypermedia-block.md)). <!-- id:VQIfC_d8 -->

# Depends on <!-- id:BTjLtIcz -->

- [hypermedia-block](./hypermedia-block.md) <!-- id:qhL6R4Ju -->
- [hypermedia-op-delete-blocks](./hypermedia-op-delete-blocks.md) <!-- id:I7YcxiFi -->
- [hypermedia-op-move-blocks](./hypermedia-op-move-blocks.md) <!-- id:QfAw7guU -->
- [hypermedia-op-replace-block](./hypermedia-op-replace-block.md) <!-- id:bKH963tB -->
- [hypermedia-op-set-attributes](./hypermedia-op-set-attributes.md) <!-- id:xn-9VfDd -->
- [hypermedia-op-set-key](./hypermedia-op-set-key.md) <!-- id:HylY6yqt -->
