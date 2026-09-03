---
name: Operation
summary: A single CRDT operation inside a Change body — a discriminated union tagged on type.
schemaDefinition: ipfs://bafyreihq3o6pih37ge7vmjz653w4xvuutuky44ults3rpqyyvl4jfur5tu
---
This document describes the **hypermedia-op** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:JsOLI17h -->

# Shape <!-- id:xCLEKTpg -->
A **union** — a value matches one of these variants: <!-- id:bdgSe4Z4 -->
  - [hypermedia-op-set-attributes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-set-attributes) <!-- id:BP_gB1f4 -->
  - [hypermedia-op-move-blocks](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-move-blocks) <!-- id:q_WzwIs6 -->
  - [hypermedia-op-replace-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-replace-block)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:DPvyep9M -->
  - [hypermedia-op-delete-blocks](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-delete-blocks) <!-- id:PlfgegNY -->
  - [hypermedia-op-set-key](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-set-key) <!-- id:HKHLdobn -->

**Generic** over `⟨Block⟩` (default [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)). <!-- id:VQIfC_d8 -->

# Depends on <!-- id:BTjLtIcz -->
- [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block) <!-- id:qhL6R4Ju -->
- [hypermedia-op-delete-blocks](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-delete-blocks) <!-- id:I7YcxiFi -->
- [hypermedia-op-move-blocks](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-move-blocks) <!-- id:QfAw7guU -->
- [hypermedia-op-replace-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-replace-block) <!-- id:bKH963tB -->
- [hypermedia-op-set-attributes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-set-attributes) <!-- id:xn-9VfDd -->
- [hypermedia-op-set-key](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op-set-key) <!-- id:HylY6yqt -->