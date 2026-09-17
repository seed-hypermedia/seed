---
name: Link
summary: The IPLD link kind, a CID inside a value that points at another block by its content, encoded as CBOR tag 42 and spelled with a slash key in DAG-JSON.
schemaDefinition: ipfs://bafyreif7e4777snpct3iqfq2fdayahrt22t5rkodphhgbb4mrr6fawd2eq
---
**Link**: a value of kind `link`: a **CID** pointing to a separate block. A _typed link_ (`{ "type":"link", "target":"x" }`) records the expected type of what it points at, checked lazily. <!-- id:6NyQz4NH -->

This page defines the **link** primitive, one of the kinds of the [IPLD data model](https://ipld.io/docs/data-model/kinds/). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:qGOy3AyI -->

A link is how one immutable blob refers to another: a Change names its `genesis` and `deps`, a Ref names its `heads`, a Comment names its `threadRoot`, a schema names the schemas it extends. Because the target is named by its hash, following a link can never give you different bytes than the author saw, and a whole history is pinned by the links from its heads. In DAG-CBOR a link is a CID under tag 42; in DAG-JSON it is `{"/": "bafy…"}`, the reserved [envelope](./schema/envelope.md) spelling. [cid](./cid.md) is the alias the blob schemas use, and [Signed Blobs](./protocol/blobs.md) explains the two hash functions that can name the same bytes. <!-- id:rSJdSYAb -->

# Shape <!-- id:X7cPl4N_ -->

Kind: `link`. <!-- id:IlnLasbp -->
