---
name: "MyApp change"
summary: "A Change instantiated with this app's block type — Change<example-app-block>. Because Block is bound, its ReplaceBlock ops are validated strictly against the ap"
---

# MyApp change

A Change instantiated with this app's block type — Change<example-app-block>. Because Block is bound, its ReplaceBlock ops are validated strictly against the app's blocks (core + Poll), deep inside the op stack — a block type the app doesn't know is rejected, unlike the open default Change.


This document describes the **example-myapp-change** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

An **instantiation** of the generic [hypermedia-change](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-change), binding: `Block` = [example-app-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-app-block).

## Depends on

- [example-app-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-app-block)
- [hypermedia-change](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-change)
