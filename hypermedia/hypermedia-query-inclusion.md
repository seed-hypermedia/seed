---
name: Query inclusion
summary: "One source a Query block pulls documents from: a space (account), an optional path prefix inside it, and whether to list direct Children or AllDescendants."
schemaDefinition: ipfs://bafyreig4rpvrwk5ws53d5l7gxmqq6jnij7aiuws547n6tqifh3mr5we22u
---
This document describes the **hypermedia-query-inclusion** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:FNiZQ7M3 -->

# Shape <!-- id:dNz8ygnf -->
A **closed struct** with these fields: <!-- id:6nE0LZik -->
  - `space` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:_Oh8MBbr -->
  - `path` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:9WR91zo6 -->
  - `mode` _(required)_ — `string` enum: `Children` `AllDescendants` <!-- id:7v3c9tNP -->

# Depends on <!-- id:NBioyAez -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:y2iLFCcl -->