---
name: Canonical Encoding
summary: DAG-CBOR's single, deterministic byte form for any value, with sorted keys and shortest integers among its rules.
---
**Canonical encoding**: [DAG-CBOR](./dag-cbor.md)'s single, deterministic byte form for any value (sorted keys, shortest integers, …). It keeps [CIDs](../cid.md) stable, and it makes JSON key order and whitespace irrelevant to the result. <!-- id:zE5avg4V -->

# See also

- [DAG-CBOR](./dag-cbor.md): the encoding this form belongs to.
- [Encoding](./encoding.md): the full rules and the human form.
- [CID](../cid.md): the hash of the canonical bytes.
- [Blobs](../protocol/blobs.md): signed blobs are canonical DAG-CBOR.
