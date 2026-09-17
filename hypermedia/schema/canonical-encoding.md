---
name: Canonical Encoding
summary: DAG-CBOR's single, deterministic byte form for any value, with sorted keys and shortest integers among its rules.
---
**Canonical encoding**: [DAG-CBOR](./dag-cbor.md)'s single, deterministic byte form for any value (sorted keys, shortest integers, …). It keeps [CIDs](../cid.md) stable, and it makes JSON key order and whitespace irrelevant to the result. <!-- id:zE5avg4V -->

# See also <!-- id:U7VNgCKc -->

- [DAG-CBOR](./dag-cbor.md): the encoding this form belongs to. <!-- id:VDg1BeNT -->
- [Encoding](./encoding.md): the full rules and the human form. <!-- id:ZCXUnuk9 -->
- [CID](../cid.md): the hash of the canonical bytes. <!-- id:KNs4EmS1 -->
- [Blobs](../protocol/blobs.md): signed blobs are canonical DAG-CBOR. <!-- id:bLbcrg9M -->
