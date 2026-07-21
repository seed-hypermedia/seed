---
name: "Onyx schema"
summary: "The meta-schema: a discriminated union of the shapes a schema can take. It is a valid instance of itself."
---

# Onyx schema

The meta-schema: a discriminated union of the shapes a schema can take. It is a valid instance of itself.


This document describes the **onyx-schema** type — the meta-schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **union** — a value matches one of these variants:

- [onyx-map-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-map-schema)
- [onyx-list-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-list-schema)
- [onyx-scalar-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-scalar-schema)
- [onyx-link-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-link-schema)
- [onyx-include-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-include-schema)
- [onyx-union-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-union-schema)
- [onyx-var-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-var-schema)

## Depends on

- [onyx-include-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-include-schema)
- [onyx-link-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-link-schema)
- [onyx-list-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-list-schema)
- [onyx-map-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-map-schema)
- [onyx-scalar-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-scalar-schema)
- [onyx-union-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-union-schema)
- [onyx-var-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-var-schema)
