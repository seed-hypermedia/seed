---
name: DAG-JSON
summary: The JSON form of the same data model, used as the human-editable form in this repo.
---
**dag-json**: the JSON form of the same [data model](./data-model.md), used as the human-editable form in this repo. It writes [links](../link.md) as `{"/":"…"}` and bytes as `{"/":{"bytes":"…"}}`. Those reserved-key objects are [envelopes](./envelope.md). <!-- id:iFdzDAvy -->

# See also

- [DAG-CBOR](./dag-cbor.md): the binary form that gets hashed and stored.
- [Envelope](./envelope.md): the `/` key spelling for links and bytes.
- [Encoding](./encoding.md): how the two forms relate.
- [IPLD](./ipld.md): the data model both forms encode.
