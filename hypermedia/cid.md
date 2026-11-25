---
name: CID
summary: A content identifier, the self-describing hash that names a blob by its bytes, written in Hypermedia as CIDv1 with the dag-cbor codec and either a SHA-256 or a BLAKE2b-256 multihash.
---
A **CID** (content identifier) is a name for a piece of data, made from the data itself. It is a hash of the bytes. The same bytes always give the same CID, and any change to the bytes gives a different CID. So a CID is the exact way to refer to stored data. <!-- id:jGQjdjiu -->

This page defines the **cid** value type. It is another name for [link](./link.md), used wherever a Hypermedia [blob](./protocol/blobs.md) points at another blob. The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show it. <!-- id:KgnNqp4m -->

# What a CID holds

A [CID](https://docs.ipfs.tech/concepts/content-addressing/) packs three things into one value: a version, a codec and a multihash. The codec says how to decode the bytes. The multihash says which hash function to use and holds the hash, so you can check the bytes. <!-- id:lseMZCq2 -->

- Hypermedia blobs are CIDv1 with the `dag-cbor` codec (0x71).
- [Files](./protocol/files.md) are `dag-pb` (0x70) with `raw` (0x55) leaves.
- In text a CIDv1 is base32. A dag-cbor blob starts with `bafyrei…` under SHA-256 and `bafy2bza…` under BLAKE2b-256. SHA-256 raw data starts with `bafkrei…`, and SHA-256 dag-pb data starts with `bafybei…`.
- In [DAG-CBOR](./schema/dag-cbor.md) a CID is tag 42. In [DAG-JSON](./schema/dag-json.md) it is written `{"/": "bafy…"}`.

# Two hash functions

Two hash functions are in use for the same codec. The [Seed daemon](./software/daemon.md) names the blobs it creates with **BLAKE2b-256**. The [SDK](./build/sdk.md), the [CLI](./build/cli.md) and the apps use **SHA-256**. <!-- id:5D5S5mIm -->

Both give a valid name for the same bytes, and the daemon accepts either when it receives a blob. But they are different names. A [Ref](./ref.md) that points at the SHA-256 CID of a [Change](./change.md) does not reach a copy stored under its BLAKE2b CID. So a publisher must supply an explicit CID for every blob that another blob references.

A [version](./protocol/documents.md) string is the CIDs of the head Changes, sorted and joined with `.`. See [Signed Blobs](./protocol/blobs.md) and [URLs](./protocol/urls.md).

# See also <!-- id:67Sc6PXL -->

- [Signed Blobs](./protocol/blobs.md): encoding, CIDs and the hash rule for publishers. <!-- id:4XugMpjB -->
- [link](./link.md): the kind a CID is stored as. <!-- id:3COiBQhg -->
- [blob](./blob.md): the envelope whose bytes a CID names. <!-- id:dFdsLAz6 -->
- [Files](./protocol/files.md): dag-pb and raw CIDs. <!-- id:qAVHPv90 -->
- [URLs](./protocol/urls.md): version strings made of CIDs. <!-- id:9uNlyqgF -->
- [Catalogue of types](./schema/types.md): every type in the library.
