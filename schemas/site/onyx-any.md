---
name: "Any"
summary: "The top type — matches any Onyx value: null, boolean, number, string, bytes, link, or a (recursively any) list or map. Use it for open, forward-compatible data."
---

# Any

The top type — matches any Onyx value: null, boolean, number, string, bytes, link, or a (recursively any) list or map. Use it for open, forward-compatible data.


This document describes the **onyx-any** type — a primitive. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **union** — a value matches one of these variants:

- [onyx-null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-null)
- [onyx-boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-boolean)
- [onyx-integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-integer)
- [onyx-float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-float)
- [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)
- [onyx-bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-bytes)
- [onyx-link](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-link)
- list of [onyx-any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-any)
- map ⟨ * : [onyx-any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-any) ⟩

## Depends on

- [onyx-boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-boolean)
- [onyx-bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-bytes)
- [onyx-float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-float)
- [onyx-integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-integer)
- [onyx-link](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-link)
- [onyx-null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-null)
- [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)
