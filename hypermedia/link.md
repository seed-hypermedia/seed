---
name: Link
summary: The IPLD link kind, a CID inside a value that points at another block by its content, encoded as CBOR tag 42 and spelled with a slash key in DAG-JSON.
schemaDefinition: ipfs://bafyreif7e4777snpct3iqfq2fdayahrt22t5rkodphhgbb4mrr6fawd2eq
---
A **link** is a value of kind `link`: a [CID](./cid.md) that points to a separate block. A _typed link_ (`{ "type":"link", "target":"x" }`) records the expected type of its target, checked lazily. <!-- id:6NyQz4NH -->

This page defines the **link** primitive, one of the kinds of the [IPLD data model](https://ipld.io/docs/data-model/kinds/). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:qGOy3AyI -->

A link is how one immutable [blob](./protocol/blobs.md) refers to another. A [Change](./change.md) names its `genesis` and `deps`, a [Ref](./ref.md) names its `heads`, a [Comment](./comment.md) names its `threadRoot`, and a schema names the schemas it extends. The target is named by its hash, so following a link can never give you different bytes than the author saw, and the links from its heads pin a whole history. In [DAG-CBOR](./schema/dag-cbor.md) a link is a CID under tag 42. In [DAG-JSON](./schema/dag-json.md) it is `{"/": "bafy…"}`, the reserved [envelope](./schema/envelope.md) spelling. [cid](./cid.md) is the alias the blob schemas use, and [Signed Blobs](./protocol/blobs.md) explains the two hash functions that can name the same bytes. <!-- id:rSJdSYAb -->

# Shape <!-- id:X7cPl4N_ -->

Kind: `link`. <!-- id:IlnLasbp -->

# See also <!-- id:e1Edar8- -->

- [cid](./cid.md): the alias blob schemas use for links. <!-- id:FHaZwEkr -->
- [Link schema](./schema/link-schema.md): typed links in a schema. <!-- id:Yf6e2l6A -->
- [Signed Blobs](./protocol/blobs.md): content addressing and the two hash functions. <!-- id:Pgrer0vM -->
- [Data model](./schema/data-model.md): all the kinds. <!-- id:ulWG6Wdm -->
