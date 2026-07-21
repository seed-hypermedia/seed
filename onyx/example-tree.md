---
name: "Tree"
summary: "A node holding an integer value and links to child nodes."
---

# Tree

A node holding an integer value and links to child nodes.


This document describes the **example-tree** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `value` *(required)* — [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer)
- `children` — list of `link` → [example-tree](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-tree)

## Depends on

- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer)
