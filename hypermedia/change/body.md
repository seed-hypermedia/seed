---
name: Change Body
summary: "The operations payload of a Change: an operation count hint and the list of ops."
schemaDefinition: ipfs://bafyreicjyyazofi3ntnkfu4hhwvu4lbgtbmqi6l4uehry3i54g366qawfq
---
This document describes the **change/body** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:c8Da_qa9 -->

# Shape <!-- id:BpgwjtEP -->

A **closed struct** with these fields: <!-- id:xndwO-1C -->
  - `opCount` — [integer](../integer.md) <!-- id:cRrknZYz -->
  - `ops` — list of [change/op](./op.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:5HwZMPHJ -->

**Generic** over `⟨Block⟩` (default [block](../block.md)). <!-- id:8rrUhiVB -->

# Depends on <!-- id:C3Z8Yr0_ -->

- [block](../block.md) <!-- id:JW5qQu6z -->
- [change/op](./op.md) <!-- id:10QhAwJr -->
- [integer](../integer.md) <!-- id:f2oL511e -->
