---
name: Any blob
summary: Any Hypermedia CBOR blob — the discriminated union of the six blob types, tagged on the type field.
schemaDefinition: ipfs://bafyreie6pr45pxkygsqrpf7qlfkno3em76yotevopvcwqmei5baxbjfadi
---
This document describes the **hypermedia-any-blob** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:uf3sIMOH -->

# Shape <!-- id:vU-ROV7h -->

A **union** — a value matches one of these variants: <!-- id:TsnOcutU -->
  - [hypermedia-change](./hypermedia-change.md) <!-- id:bRPYzuid -->
  - [hypermedia-ref](./hypermedia-ref.md) <!-- id:EP8vzpnL -->
  - [hypermedia-profile](./hypermedia-profile.md) <!-- id:ThGWnfaK -->
  - [hypermedia-comment](./hypermedia-comment.md) <!-- id:BsccYSi3 -->
  - [hypermedia-capability](./hypermedia-capability.md) <!-- id:xofU45np -->
  - [hypermedia-contact](./hypermedia-contact.md) <!-- id:qvwBCe01 -->

# Depends on <!-- id:7fzRuDS8 -->

- [hypermedia-capability](./hypermedia-capability.md) <!-- id:IoFhiaE3 -->
- [hypermedia-change](./hypermedia-change.md) <!-- id:UhG4UV8N -->
- [hypermedia-comment](./hypermedia-comment.md) <!-- id:ZsN-8iYj -->
- [hypermedia-contact](./hypermedia-contact.md) <!-- id:5v8hyrIb -->
- [hypermedia-profile](./hypermedia-profile.md) <!-- id:DiDCtHSa -->
- [hypermedia-ref](./hypermedia-ref.md) <!-- id:WAyUTcQu -->
