---
name: Any Blob
summary: "Any Hypermedia CBOR blob: the discriminated union of the six blob types, tagged on the type field."
schemaDefinition: ipfs://bafyreiaaqbdz22df2kkedhouarep2lmayxir52u3yzt52mst55noawt3f4
---
The **blob/any** type is any Hypermedia CBOR [blob](../protocol/blobs.md): the [discriminated union](../schema/discriminated-union.md) of every Hypermedia Network blob schema, tagged on the `type` field. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:uf3sIMOH -->

# Shape <!-- id:vU-ROV7h -->

A **union**. A value matches one of these variants: <!-- id:TsnOcutU -->
  - [change](../change.md) <!-- id:bRPYzuid -->
  - [ref](../ref.md) <!-- id:EP8vzpnL -->
  - [profile](../profile.md) <!-- id:ThGWnfaK -->
  - [comment](../comment.md) <!-- id:BsccYSi3 -->
  - [capability](../capability.md) <!-- id:xofU45np -->
  - [contact](../contact.md) <!-- id:qvwBCe01 -->

# Depends on <!-- id:7fzRuDS8 -->

- [capability](../capability.md) <!-- id:IoFhiaE3 -->
- [change](../change.md) <!-- id:UhG4UV8N -->
- [comment](../comment.md) <!-- id:ZsN-8iYj -->
- [contact](../contact.md) <!-- id:5v8hyrIb -->
- [profile](../profile.md) <!-- id:DiDCtHSa -->
- [ref](../ref.md) <!-- id:WAyUTcQu -->

# See also <!-- id:ESSnX0hn -->

- [blob](../blob.md): the signed envelope all six types extend. <!-- id:DkUt2bp2 -->
- [Signed Blobs](../protocol/blobs.md): encoding, CIDs and what the daemon accepts. <!-- id:mwBeWZsY -->
- [Network blobs](../schema/blobs.md): the blob types as schemas. <!-- id:8d7iIjc4 -->
- [Discriminated union](../schema/discriminated-union.md): how the `type` tag selects a variant. <!-- id:k_kJEZkf -->
