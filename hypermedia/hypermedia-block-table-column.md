---
name: Table column block
summary: "One column of a Table block: childless, identified by its block id (cells reference it via their columnId attribute), ordered by sibling position."
schemaDefinition: ipfs://bafyreidoeic35ydpgcolua454itlyohnglrz73ziitnqcriggaw63crqaa
---
This document describes the **hypermedia-block-table-column** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:c4wVHkyt -->

# Shape <!-- id:TfYjxpaq -->

**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:Vc-3f7Au -->
  - `type` — `string` enum: `TableColumn` <!-- id:lyKmvrCD -->
  - `attributes` — map { 4 fields } <!-- id:a7O4P0xL -->

# Depends on <!-- id:xtBSktC5 -->

- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:54ILX_5f -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:Unn54V5j -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:jnBF15oW -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:SWXNYg6f -->
