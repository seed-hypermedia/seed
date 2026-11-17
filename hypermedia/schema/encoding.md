---
name: Encoding
summary: How Hypermedia values and schemas are encoded, with DAG-CBOR as the canonical form, dag-json as the form people read, the reserved slash key for links and bytes, and the canonical encoding that keeps CIDs stable.
---
Hypermedia values, both schemas and the data they type, are [DAG-CBOR](./dag-cbor.md) blocks on IPFS. DAG-CBOR is a restricted, deterministic profile of binary CBOR with built-in support for links ([CIDs](../protocol/blobs.md)). It is the canonical wire form. The same encoding carries the network's signed [blobs](../protocol/blobs.md). <!-- id:xr_d_48R -->

People cannot edit DAG-CBOR directly, so schemas and values are written in [dag-json](./dag-json.md), the JSON projection of the same [data model](./data-model.md). A person can read and diff dag-json, and tools convert it to and from DAG-CBOR with no loss that matters here. <!-- id:hGuzUAVh -->

``` <!-- id:grYnFGUo -->
   dag-json  (files, human form)      <——>  DAG-CBOR  (IPFS, canonical form)
   JSON text, hm:// name refs                binary, hm:// name refs, CID links
```

# The reserved `/` key <!-- id:j0GQ_2TD -->

JSON has no native way to write bytes or a link. dag-json borrows map syntax with **one reserved key, `/`**. Each of these spellings is a dag-json [envelope](./envelope.md): <!-- id:YpcMmEMS -->

<!-- id:gZfcUpHN -->
| kind <!-- col:Lf10HYeS --> | dag-json <!-- col:M8I8Wqkg --> | DAG-CBOR <!-- col:7vTETkPd --> <!-- id:Je27na7i --> |
| --- | --- | --- |
| link | `{"/":"bafy…"}` | CID (tag 42) <!-- id:WXOoojol --> |
| bytes | `{"/":{"bytes":"aGVsbG8"}}` | byte string (major type 2), base64 in JSON <!-- id:FtMcyizZ --> |

**These are not maps.** They are the JSON spelling of two separate [kinds](./kind.md). In DAG-CBOR there is no ambiguity: a link is a tagged CID and bytes are a byte string. In dag-json they look like maps. This causes dag-json's one trap: a real data map with a single `/` key cannot be told apart from a link. <!-- id:Bq6LLLsU -->

The schema language's rule avoids the trap (see [the data model](./data-model.md)). Links and bytes are **atomic kinds**, and a schema never describes them as maps. A schema says `{"type":"link"}` and never reaches inside the envelope. The validator enforces this. It recognizes the two envelopes and reports `link` or `bytes`, so a value typed `map` rejects a `{"/":…}` shape, and the reverse also holds. <!-- id:2x73pir3 -->

# Canonical encoding <!-- id:_xPmfmd5 -->

CIDs are content hashes, so **the same value must always encode to the same bytes**. Otherwise its CID would change. DAG-CBOR requires a [canonical encoding](./canonical-encoding.md): <!-- id:E8QsaeNL -->
  - map keys sorted by a defined ordering, <!-- id:l6YAoUHJ -->
  - shortest-form integer encodings, <!-- id:MJGGUCHC -->
  - no floating-point NaN/Infinity, <!-- id:D1qqS-Rb -->
  - exactly one way to encode any value. <!-- id:ADsShIXd -->

For authors, **key order and formatting in a dag-json file do not matter.** Whitespace and the order of `properties` do not change the resulting block or its CID, because the encoder normalizes them. Two schemas that differ only in key order are the same block with the same CID. <!-- id:1XV1UcRp -->

# A schema's CID

A schema is encoded to canonical DAG-CBOR and content-addressed as a CIDv1 with sha2-256 and the `dag-cbor` codec (0x71). The [daemon](../software/daemon.md) uses the same codec for its blobs. The encoding is deterministic, so **the CID is a pure function of a schema's content**: any tool that recomputes it gets the same [CID](../cid.md).

A schema refers to other schemas by **name**, and the names stay names in the encoded bytes. So a schema's CID depends only on its own bytes. Editing `block` does **not** change the CID of `change`. In a graph linked by CID, any change would propagate upward. [References and naming](./references.md) explains why references are names, and [the library pipeline](./library-pipeline.md) describes how the Seed repository computes and pins the CIDs of its own schemas.

# See also <!-- id:f3T2QJJS -->

- [References and naming](./references.md): why references are names and not CIDs. <!-- id:a5VF35ot -->
- [The data model](./data-model.md): the nine kinds, including link and bytes. <!-- id:-R8AO22o -->
- [DAG-CBOR](./dag-cbor.md), [dag-json](./dag-json.md), [Envelope](./envelope.md) and [Canonical encoding](./canonical-encoding.md): the term pages. <!-- id:-lKkBjIt -->
- [Blobs](../protocol/blobs.md): how the network encodes and signs its data. <!-- id:bMA7jKeP -->
- [CID](../cid.md): the CID type. <!-- id:IxZuGZOV -->
- [Schemas for network blobs](./blobs.md): the blob schemas built on this encoding. <!-- id:ylJUSWo0 -->
- [Typing a blob](./typing-a-blob.md): the `schema` field that links a raw object to its schema.
