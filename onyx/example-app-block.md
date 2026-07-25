---
name: "App block (extended core)"
summary: "How a third party extends the block model: the union of Hypermedia's core blocks PLUS their own custom blocks (here, a Poll). Strict — it accepts core blocks an"
---

# App block (extended core)

How a third party extends the block model: the union of Hypermedia's core blocks PLUS their own custom blocks (here, a Poll). Strict — it accepts core blocks and Polls, and rejects block types it doesn't know. An app validates its documents against this.


This document describes the **example-app-block** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **union** — a value matches one of these variants:

- [hypermedia-block-core](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-core)
- [example-poll-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-poll-block)

## Depends on

- [example-poll-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-poll-block)
- [hypermedia-block-core](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-core)
