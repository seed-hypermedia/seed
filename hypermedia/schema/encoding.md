---
name: Encoding
summary: Hypermedia values and schemas are stored as DAG-CBOR bytes and written by people as dag-json, and one fixed way of encoding keeps every CID stable.
---
Hypermedia stores every value as bytes in a format called [DAG-CBOR](./dag-cbor.md). This is true for a schema and for the data it describes. People do not read bytes, so they write the same values as [dag-json](./dag-json.md), which is JSON with two small additions. This page explains both forms and how they give each value a stable [CID](../cid.md), the hash that names it.

DAG-CBOR is a strict form of the binary format CBOR. One value always gives the same bytes, and the format has a built-in way to write a link (a CID). The network's signed [blobs](../protocol/blobs.md) use the same encoding. <!-- id:xr_d_48R -->

dag-json holds the same [data model](./data-model.md) as text. A person can read it and compare two versions. Tools convert it to DAG-CBOR and back, and nothing that matters here is lost. <!-- id:hGuzUAVh -->

``` <!-- id:grYnFGUo -->
   dag-json  (files, human form)      <──>  DAG-CBOR  (IPFS, canonical form)
   JSON text, hm:// name refs                binary, hm:// name refs, CID links
```

# The reserved `/` key <!-- id:j0GQ_2TD -->

JSON has no way of its own to write bytes or a link. dag-json writes them as a map with **one reserved key, `/`**. Each of these two forms is a dag-json [envelope](./envelope.md): <!-- id:YpcMmEMS -->

<!-- id:gZfcUpHN -->
| kind <!-- col:Lf10HYeS --> | dag-json <!-- col:M8I8Wqkg --> | DAG-CBOR <!-- col:7vTETkPd --> <!-- id:Je27na7i --> |
| --- | --- | --- |
| link | `{"/":"bafy…"}` | CID (tag 42) <!-- id:WXOoojol --> |
| bytes | `{"/":{"bytes":"aGVsbG8"}}` | byte string (major type 2), base64 in JSON <!-- id:FtMcyizZ --> |

**These are not maps.** They are how JSON writes two separate [kinds](./kind.md). In DAG-CBOR nothing can be confused: a link is a tagged CID, and bytes are a byte string. In dag-json they look like maps. So dag-json has one trap: a real map of data with the single key `/` looks the same as a link. <!-- id:Bq6LLLsU -->

The [schema language](./schema-language.md) has a rule that avoids the trap (see [the data model](./data-model.md)). A link and a byte string are each **one whole value**, and a schema never describes them as maps. A schema says `{"type":"link"}` and never looks inside the envelope. The validator applies the rule. It knows the two envelopes and reports them as `link` or `bytes`. So a value typed `map` rejects a `{"/":…}` shape, and a value typed `link` rejects an ordinary map. <!-- id:2x73pir3 -->

# Canonical encoding <!-- id:_xPmfmd5 -->

A CID is a hash of the bytes. So **the same value must always encode to the same bytes**, or its CID would change. DAG-CBOR requires a [canonical encoding](./canonical-encoding.md): <!-- id:E8QsaeNL -->
  - map keys are sorted in one defined order, <!-- id:l6YAoUHJ -->
  - integers use their shortest form, <!-- id:MJGGUCHC -->
  - the floats NaN and Infinity are not allowed, <!-- id:D1qqS-Rb -->
  - every value has exactly one encoding. <!-- id:ADsShIXd -->

For an author, **the order of keys and the formatting of a dag-json file do not matter.** Whitespace and the order of `properties` do not change the encoded bytes or the CID, because the encoder puts everything in the canonical form. Two schemas that differ only in key order are the same blob with the same CID. <!-- id:1XV1UcRp -->

# A schema's CID

A schema is encoded to canonical DAG-CBOR. Its CID is a CIDv1 with the sha2-256 hash and the `dag-cbor` codec (0x71). The [daemon](../software/daemon.md) uses the same codec for its blobs. The encoding always gives the same bytes, so **the CID depends only on the schema's content**. Any tool that computes it again gets the same [CID](../cid.md).

A schema refers to other schemas by **name**, and the names stay names in the encoded bytes. So a schema's CID depends only on its own bytes. Editing `block` does **not** change the CID of `change`. If schemas pointed at each other by CID, one edit would change the CID of every schema above it. [References and naming](./references.md) explains why references are names. [The library pipeline](./library-pipeline.md) describes how the Seed repository computes and records the CIDs of its own schemas.

# See also <!-- id:f3T2QJJS -->

- [References and naming](./references.md): why references are names and not CIDs. <!-- id:a5VF35ot -->
- [The data model](./data-model.md): the nine kinds, including link and bytes. <!-- id:-R8AO22o -->
- [DAG-CBOR](./dag-cbor.md), [dag-json](./dag-json.md), [Envelope](./envelope.md) and [Canonical encoding](./canonical-encoding.md): the term pages. <!-- id:-lKkBjIt -->
- [Blobs](../protocol/blobs.md): how the network encodes and signs its data. <!-- id:bMA7jKeP -->
- [CID](../cid.md): the CID type. <!-- id:IxZuGZOV -->
- [Schemas for network blobs](./blobs.md): the blob schemas built on this encoding. <!-- id:ylJUSWo0 -->
- [Typing a blob](./typing-a-blob.md): the `schema` field that links a raw object to its schema.
