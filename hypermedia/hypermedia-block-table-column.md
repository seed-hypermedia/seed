---
name: Table column block
summary: "One column of a Table block: childless, identified by its block id (cells reference it via their columnId attribute), ordered by sibling position."
schemaDefinition: ipfs://bafyreidoeic35ydpgcolua454itlyohnglrz73ziitnqcriggaw63crqaa
---
This document describes the **hypermedia-block-table-column** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:c4wVHkyt -->

# Shape <!-- id:TfYjxpaq -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:Vc-3f7Au -->
  - `type` — `string` enum: `TableColumn` <!-- id:lyKmvrCD -->
  - `attributes` — map { 4 fields } <!-- id:a7O4P0xL -->

# Depends on <!-- id:xtBSktC5 -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:54ILX_5f -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:Unn54V5j -->
- [boolean](./onyx-boolean.md) <!-- id:jnBF15oW -->
- [float](./onyx-float.md) <!-- id:SWXNYg6f -->
