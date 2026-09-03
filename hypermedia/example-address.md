---
name: "Example: Address"
summary: "A postal address: street and city (required) plus an optional postal code."
schemaDefinition: ipfs://bafyreibm7tczwmqu72y5l4xx6anh353reolctot5aanbnpkecm7ivetofe
---
This document describes the **example-address** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zGVF-gc0 -->

# Shape <!-- id:lFNyvCCx -->
A **closed struct** with these fields: <!-- id:XGrPnmSZ -->
  - `street` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:HT49CZz8 -->
  - `city` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:qzZ2rGQ3 -->
  - `postalCode` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:PeOlj5sn -->

# Depends on <!-- id:Rd4ib7lU -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:WE2Dzd5r -->