---
name: Table row block
summary: One row of a Table block. Its children are Paragraph cell blocks, each carrying a columnId attribute referencing a TableColumn id.
schemaDefinition: ipfs://bafyreibsdacs6h7djddwmsgpdc2xmlbsye6jyqk7bgfeuaf3q6y3c6faxi
---
This document describes the **hypermedia-block-table-row** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:BjIgY6_L -->

# Shape <!-- id:rU9d2YT4 -->

**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:YSpWVasd -->
  - `type` — `string` enum: `TableRow` <!-- id:35dzjlct -->
  - `attributes` — map { 3 fields } <!-- id:isb0u9Q- -->

# Depends on <!-- id:bJfnmYvm -->

- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:hgpcc-H3 -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:wlSrjJ0K -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:x3gfdVig -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:XcI_JSRk -->
