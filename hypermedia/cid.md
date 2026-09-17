---
name: CID
summary: A content identifier, the self-describing hash that names a blob by its bytes, written in Hypermedia as CIDv1 with the dag-cbor codec and either a SHA-256 or a BLAKE2b-256 multihash.
schemaDefinition: ipfs://bafyreif7e4777snpct3iqfq2fdayahrt22t5rkodphhgbb4mrr6fawd2eq
---
**CID** — Content IDentifier: a self-describing hash that names a block by its content. The canonical form of a reference. <!-- id:jGQjdjiu -->

This page defines the **cid** value type, an alias of [link](./link.md) used wherever a Hypermedia blob points at another blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:KgnNqp4m -->

A [CID](https://docs.ipfs.tech/concepts/content-addressing/) packs a version, a codec and a multihash into one value, so the name says how to decode the bytes and how to check them. Hypermedia blobs are CIDv1 with the `dag-cbor` codec (0x71) and files are `dag-pb` (0x70) with `raw` (0x55) leaves; in text a CIDv1 is base32 and starts with `bafy…` (dag-cbor) or `bafk…`/`bafyb…` (raw and dag-pb). In DAG-CBOR a CID is tag 42 and in DAG-JSON it is spelled `{"/": "bafy…"}`. <!-- id:lseMZCq2 -->

Two hash functions are in use for the same codec. The Seed daemon names the blobs it creates with **BLAKE2b-256**; the SDK, CLI and apps use **SHA-256**. Both are valid names for the same bytes and the daemon accepts either on ingest, but they are different names: a Ref that points at the SHA-256 CID of a Change does not reach a copy stored under its BLAKE2b CID. The rule for publishers is to supply an explicit CID for every blob that another blob references. A version string is CIDs of head Changes sorted and joined with `.`; see [Signed Blobs](./protocol/blobs.md) and [URLs](./protocol/urls.md). <!-- id:5D5S5mIm -->

# Shape <!-- id:efsrvawv -->

An **alias** of [link](./link.md). <!-- id:bqb7XsxG -->

# Depends on <!-- id:1T45v5dv -->

- [link](./link.md) <!-- id:WkXd4lGr -->
