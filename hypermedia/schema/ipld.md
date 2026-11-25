---
name: IPLD
summary: IPLD (InterPlanetary Linked Data) is the data model of IPFS, and its nine kinds of value are the ones Hypermedia Schemas describe.
---
**IPLD** means InterPlanetary Linked Data. It is the data model of IPFS: a small set of rules for what a value can be. It has nine [kinds](./kind.md) of value, such as string, list, map and link. <!-- id:DFPV_ngv -->

[Hypermedia Schemas](../schema.md) use this data model as it is. A schema is a layer on top: it says which IPLD values are valid for one type.

# See also <!-- id:tdveyF7H -->

- [The data model](./data-model.md): the nine kinds as Hypermedia Schemas use them. <!-- id:-ddQxUAL -->
- [DAG-CBOR](./dag-cbor.md): the binary encoding of IPLD data. <!-- id:rEvtu5q4 -->
- [dag-json](./dag-json.md): the JSON form. <!-- id:HJNKueFP -->
- [Blobs](../protocol/blobs.md): the network's IPLD objects. <!-- id:TF_tJy2l -->
