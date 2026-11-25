---
name: Link
summary: The IPLD link kind, a CID inside a value that points at another block by its content, encoded as CBOR tag 42 and spelled with a slash key in DAG-JSON.
---
A **link** points from one piece of data to another by its hash. Following a link always gives the same bytes the author saw. The value is a [CID](./cid.md). A schema can also say what type the target must be: a _typed link_ (`{ "type":"link", "target":"x" }`). The type is checked only when the link is followed. <!-- id:6NyQz4NH -->

This page defines the **link** primitive, one of the kinds of the [IPLD data model](https://ipld.io/docs/data-model/kinds/). Its formal schema is attached to this [document](./protocol/documents.md) as the `schemaDefinition` key of its metadata, so the app can show it. <!-- id:qGOy3AyI -->

A link is how one immutable [blob](./protocol/blobs.md) refers to another. A [Change](./change.md) names its `genesis` and `deps`. A [Ref](./ref.md) names its `heads`. A [Comment](./comment.md) names its `threadRoot`. A schema names the schemas it extends. The target is named by its hash, so a link can never lead to different bytes than the author saw. The links from a document's heads fix its whole history. In [DAG-CBOR](./schema/dag-cbor.md) a link is a CID under tag 42. In [DAG-JSON](./schema/dag-json.md) it is `{"/": "bafy…"}`, the reserved-key [envelope](./schema/envelope.md) spelling of dag-json. [cid](./cid.md) is the alias the blob schemas use. [Signed Blobs](./protocol/blobs.md) explains the two hash functions that can name the same bytes. <!-- id:rSJdSYAb -->

# See also <!-- id:e1Edar8- -->

- [cid](./cid.md): the alias blob schemas use for links. <!-- id:FHaZwEkr -->
- [Link schema](./schema/link-schema.md): typed links in a schema. <!-- id:Yf6e2l6A -->
- [Signed Blobs](./protocol/blobs.md): content addressing and the two hash functions. <!-- id:Pgrer0vM -->
- [Data model](./schema/data-model.md): all the kinds. <!-- id:ulWG6Wdm -->
- [Catalogue of types](./schema/types.md): every type in the library.
