---
name: Any Blob
summary: "Any Hypermedia CBOR blob: the discriminated union of the six blob types, tagged on the type field."
---
The **blob/any** type is any Hypermedia CBOR [blob](../protocol/blobs.md): the [discriminated union](../schema/discriminated-union.md) of every Hypermedia Network blob schema, tagged on the `type` field. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:uf3sIMOH -->

# See also <!-- id:ESSnX0hn -->

- [blob](../blob.md): the signed envelope all six types extend. <!-- id:DkUt2bp2 -->
- [Signed Blobs](../protocol/blobs.md): encoding, CIDs and what the daemon accepts. <!-- id:mwBeWZsY -->
- [Network blobs](../schema/blobs.md): the blob types as schemas. <!-- id:8d7iIjc4 -->
- [Discriminated union](../schema/discriminated-union.md): how the `type` tag selects a variant. <!-- id:k_kJEZkf -->
