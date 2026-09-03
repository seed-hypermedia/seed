---
name: Table block
summary: "A table container. Its children are TableColumn blocks (childless; their sibling order defines column display order) followed by TableRow blocks whose children "
schemaDefinition: ipfs://bafyreigqfikouxb4wtgn5smb3zsik3f2qahmdp2kwzfsxv2r52bixuouu4
---
A table container. Its children are TableColumn blocks (childless; their sibling order defines column display order) followed by TableRow blocks whose children are Paragraph cells carrying a columnId attribute — cell identity is (row, columnId), never grid position, which is what lets concurrent CRDT edits merge cleanly. <!-- id:62GngDOo -->

This document describes the **hypermedia-block-table** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:H3fdehxc -->

# Shape <!-- id:axji3Nx3 -->
**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:WAdLuZ1t -->
  - `type` — `string` enum: `Table` <!-- id:OIXFENDr -->
  - `attributes` — map { 2 fields } <!-- id:1Ug72bRZ -->

# Depends on <!-- id:AgnaGp59 -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:fu5elJWe -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:hg7kQizu -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:k8jv_Gf6 -->