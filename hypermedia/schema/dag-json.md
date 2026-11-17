---
name: DAG-JSON
summary: DAG-JSON is the JSON form of Hypermedia data that people read and edit, and DAG-CBOR is the form that is hashed and stored.
---
**dag-json** is the JSON form of Hypermedia data. It is the form people read and edit, and schema files are written in it. It holds the same [data model](./data-model.md) as [DAG-CBOR](./dag-cbor.md), the binary form that is hashed and stored. <!-- id:iFdzDAvy -->

JSON has no way to write a link or raw bytes, so dag-json adds one. It writes a [link](../link.md) as `{"/":"…"}` and [bytes](../bytes.md) as `{"/":{"bytes":"…"}}`. These objects with the reserved `/` key are called [envelopes](./envelope.md).

# See also <!-- id:HZxh7aJc -->

- [DAG-CBOR](./dag-cbor.md): the binary form that gets hashed and stored. <!-- id:EivxBv2I -->
- [Envelope](./envelope.md): the `/` key spelling for links and bytes. <!-- id:xUxTlSUn -->
- [Encoding](./encoding.md): how the two forms relate. <!-- id:Vgi5lhAz -->
- [IPLD](./ipld.md): the data model both forms encode. <!-- id:7f5teCeX -->
