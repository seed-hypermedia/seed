---
name: DAG-JSON
summary: The JSON form of the same data model, used as the human-editable form in this repo.
---
**dag-json**: the JSON form of the same [data model](./data-model.md), used as the human-editable form in this repo. It writes [links](../link.md) as `{"/":"…"}` and bytes as `{"/":{"bytes":"…"}}`. Those reserved-key objects are [envelopes](./envelope.md). <!-- id:iFdzDAvy -->

# See also <!-- id:HZxh7aJc -->

- [DAG-CBOR](./dag-cbor.md): the binary form that gets hashed and stored. <!-- id:EivxBv2I -->
- [Envelope](./envelope.md): the `/` key spelling for links and bytes. <!-- id:xUxTlSUn -->
- [Encoding](./encoding.md): how the two forms relate. <!-- id:Vgi5lhAz -->
- [IPLD](./ipld.md): the data model both forms encode. <!-- id:7f5teCeX -->
