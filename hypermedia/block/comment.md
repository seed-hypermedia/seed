---
name: Comment Block
summary: "A comment content block: a Block extended with a recursive list of child comment blocks."
schemaDefinition: ipfs://bafyreibth2kanwonruhp2b37xi72lvds5kddpmwlymwrky4ft7fm53o434
---
This document describes the **block/comment** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:mJYa3roS -->

# Shape <!-- id:KpgzcxVT -->

**Extends** [block](../block.md) with these added fields: <!-- id:tCclGqa- -->
  - `children` — list of [block/comment](./comment.md) <!-- id:2Z5R3yQN -->

# Depends on <!-- id:vdGecCjq -->

- [block](../block.md) <!-- id:ijTeP4H8 -->
