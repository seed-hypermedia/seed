---
name: Canonical Encoding
summary: The canonical encoding is the one byte form that DAG-CBOR allows for each value, so the same value always gets the same CID.
---
The **canonical encoding** is the one byte form that [DAG-CBOR](./dag-cbor.md) allows for each value. The same value always gives the same bytes. Two of its rules: map keys are sorted, and an integer uses the shortest form that holds it. <!-- id:zE5avg4V -->

This matters because a [CID](../cid.md) is a hash of the bytes. One byte form means one CID for each value. It also means that the key order and the spacing of a JSON file do not change the result.

# See also <!-- id:U7VNgCKc -->

- [DAG-CBOR](./dag-cbor.md): the encoding this form belongs to. <!-- id:VDg1BeNT -->
- [Encoding](./encoding.md): the full rules and the human form. <!-- id:ZCXUnuk9 -->
- [CID](../cid.md): the hash of the canonical bytes. <!-- id:KNs4EmS1 -->
- [Blobs](../protocol/blobs.md): signed blobs are canonical DAG-CBOR. <!-- id:bLbcrg9M -->
