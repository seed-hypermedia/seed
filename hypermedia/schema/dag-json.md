---
name: DAG-JSON
summary: The JSON form of the IPLD data model, which is the form people read and edit, where DAG-CBOR is the form that is hashed and stored.
---
**dag-json**: the JSON form of the same [data model](./data-model.md) that [DAG-CBOR](./dag-cbor.md) encodes. It is the form people read and edit, and schema files are written in it. It writes [links](../link.md) as `{"/":"…"}` and bytes as `{"/":{"bytes":"…"}}`. Those reserved-key objects are [envelopes](./envelope.md). <!-- id:iFdzDAvy -->

# See also <!-- id:HZxh7aJc -->

- [DAG-CBOR](./dag-cbor.md): the binary form that gets hashed and stored. <!-- id:EivxBv2I -->
- [Envelope](./envelope.md): the `/` key spelling for links and bytes. <!-- id:xUxTlSUn -->
- [Encoding](./encoding.md): how the two forms relate. <!-- id:Vgi5lhAz -->
- [IPLD](./ipld.md): the data model both forms encode. <!-- id:7f5teCeX -->
