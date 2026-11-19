---
name: DAG-CBOR
summary: DAG-CBOR is the binary form in which every Hypermedia blob and schema is stored and hashed.
---
**DAG-CBOR** is the binary form in which Hypermedia data is stored on IPFS. Every [blob](../protocol/blobs.md) and every [schema](../schema.md) is stored in this form. <!-- id:MTZmummk -->

DAG-CBOR is a strict version of CBOR, a compact binary format. It adds two things:

- **One byte form for each value.** This is the [canonical encoding](./canonical-encoding.md). The same value always gives the same bytes, so it always gets the same [CID](../cid.md).
- **Links.** A value can hold a CID that points at another stored object. See [link](../link.md).

# See also <!-- id:UDMNyNPe -->

- [Canonical encoding](./canonical-encoding.md): the single byte form for each value. <!-- id:ThprTPZR -->
- [dag-json](./dag-json.md): the JSON form people edit. <!-- id:grZaaUpw -->
- [Encoding](./encoding.md): how schemas and values are encoded. <!-- id:6xHeJJrH -->
- [IPLD](./ipld.md): the data model DAG-CBOR encodes. <!-- id:fvpvK9uE -->
- [Blobs](../protocol/blobs.md): the signed objects stored as DAG-CBOR. <!-- id:DOCnsL8H -->
