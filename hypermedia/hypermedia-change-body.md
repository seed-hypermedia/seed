---
name: Change body
summary: "The operations payload of a Change: an operation count hint and the list of ops."
schemaDefinition: ipfs://bafyreidoh5svgjwux5wfbxi7wugubtrknig543mjqnutjcmn6zgzxnsgbm
---
This document describes the **hypermedia-change-body** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:c8Da_qa9 -->

# Shape <!-- id:BpgwjtEP -->

A **closed struct** with these fields: <!-- id:xndwO-1C -->
  - `opCount` — [integer](./onyx-integer.md) <!-- id:cRrknZYz -->
  - `ops` — list of [hypermedia-op](./hypermedia-op.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:5HwZMPHJ -->

**Generic** over `⟨Block⟩` (default [hypermedia-block](./hypermedia-block.md)). <!-- id:8rrUhiVB -->

# Depends on <!-- id:C3Z8Yr0_ -->

- [hypermedia-block](./hypermedia-block.md) <!-- id:JW5qQu6z -->
- [hypermedia-op](./hypermedia-op.md) <!-- id:10QhAwJr -->
- [integer](./onyx-integer.md) <!-- id:f2oL511e -->
