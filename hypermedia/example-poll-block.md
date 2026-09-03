---
name: "Example: Poll block (custom)"
summary: "An example third-party block type: a poll with a question and options. It extends the shared block base, exactly like a core block."
schemaDefinition: ipfs://bafyreialxz474yba5znsmj4qa5sqg7u7qdqmmu42cee6jogjimq5ny6zni
---
This document describes the **example-poll-block** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:UMzXooSA -->

# Shape <!-- id:aF0A6qUJ -->

**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:AU7ub5dT -->
  - `type` — `string` enum: `Poll` <!-- id:a5Im9O50 -->
  - `question` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:MVAEf3cE -->
  - `options` _(required)_ — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:pU77dcCF -->
  - `attributes` — map { 3 fields } <!-- id:jJ3NLW4y -->

# Depends on <!-- id:czM-qx6F -->

- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:JO2qNB-c -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:RHMZeOH4 -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:Ljf2W4Wk -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:-D8eUkTH -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:6y4r4lDq -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:w5tshfF6 -->
