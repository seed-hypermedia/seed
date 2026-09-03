---
name: Change body
summary: "The operations payload of a Change: an operation count hint and the list of ops."
schemaDefinition: ipfs://bafyreifmt26oncx7r3b444i4pcu6wecgqszfyrr4edlk7sevwgw7xsea6e
---
This document describes the **hypermedia-change-body** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:c8Da_qa9 -->

# Shape <!-- id:BpgwjtEP -->
A **closed struct** with these fields: <!-- id:xndwO-1C -->
  - `opCount` — [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:cRrknZYz -->
  - `ops` — list of [hypermedia-op](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:5HwZMPHJ -->

**Generic** over `⟨Block⟩` (default [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)). <!-- id:8rrUhiVB -->

# Depends on <!-- id:C3Z8Yr0_ -->
- [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block) <!-- id:JW5qQu6z -->
- [hypermedia-op](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-op) <!-- id:10QhAwJr -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:f2oL511e -->