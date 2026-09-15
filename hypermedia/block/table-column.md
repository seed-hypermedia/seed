---
name: Table Column Block
summary: "One column of a Table block: childless, identified by its block id (cells reference it via their columnId attribute), ordered by sibling position."
schemaDefinition: ipfs://bafyreif5sty3plr5qbzicnlvautua35j6aapiwin4mwubeuhhrorxcd6ve
---
This document describes the **block/table-column** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:c4wVHkyt -->

# Shape <!-- id:TfYjxpaq -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:Vc-3f7Au -->
  - `type` — `"TableColumn"` <!-- id:lyKmvrCD -->
  - `attributes` — map { 4 fields } <!-- id:a7O4P0xL -->

# Depends on <!-- id:xtBSktC5 -->

- [block/base](./base.md) <!-- id:54ILX_5f -->
- [block/children-type](./children-type.md) <!-- id:Unn54V5j -->
- [boolean](../boolean.md) <!-- id:jnBF15oW -->
- [float](../float.md) <!-- id:SWXNYg6f -->
