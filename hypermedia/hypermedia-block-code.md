---
name: Code block
summary: A code block, optionally tagged with a language.
schemaDefinition: ipfs://bafyreiaewb53rmab6zeputil3zsmqyrrxbfigszcphedzxu4vec5paahk4
---
This document describes the **hypermedia-block-code** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fqG3-TI_ -->

# Shape <!-- id:Wlv2TURN -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:M3xZk6r7 -->
  - `type` — `"Code"` <!-- id:F_X9vLc- -->
  - `text` — [string](./hypermedia-string.md) <!-- id:1CNgUNEp -->
  - `attributes` — map { 3 fields } <!-- id:IzYor5cE -->

# Depends on <!-- id:1PZKCBGr -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:UPJREQHL -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:lrSmJj0P -->
- [any](./hypermedia-any.md) <!-- id:FPY-Yu6f -->
- [float](./hypermedia-float.md) <!-- id:dPDYHZ7F -->
- [string](./hypermedia-string.md) <!-- id:ui04XeY6 -->
