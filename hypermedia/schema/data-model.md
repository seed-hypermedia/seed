---
name: Data Model
summary: The nine IPLD kinds every Hypermedia value is built from, with link and bytes as built-in primitives.
---
# The data model <!-- id:1K3uAm_K -->

Hypermedia Schemas type values from the **[IPLD](./ipld.md) data model**, the set of kinds [DAG-CBOR](./dag-cbor.md) can encode. There are **nine [kinds](./kind.md)**. Every value is exactly one of them. <!-- id:geSDK1S_ -->

<!-- id:a8BD2izY -->
| kind <!-- col:HbgVvtTb --> | JSON / dag-json form <!-- col:FqheG8jM --> | notes <!-- col:bWMpxxLR --> <!-- id:OvMqcdvO --> |
| --- | --- | --- |
| `null` | `null` | <!-- id:IBoVXWo- --> |
| `boolean` | `true` / `false` | <!-- id:RwAQFxQi --> |
| `integer` | `42` | DAG-CBOR encodes ints and floats **differently** <!-- id:cVihAylW --> |
| `float` | `3.14` | <!-- id:1cgFWZ3X --> |
| `string` | `"hi"` | UTF-8 text <!-- id:V5tUQxNr --> |
| `bytes` | `{"/":{"bytes":"aGVsbG8"}}` | raw octets; base64 in dag-json <!-- id:e1LXXg47 --> |
| `list` | `[…]` | ordered sequence <!-- id:A4hk_Kp6 --> |
| `map` | `{…}` | keys are strings; ordered, unique <!-- id:3jxicrAc --> |
| `link` | `{"/":"bafy…"}` | a **CID**: a content-addressed pointer to another block <!-- id:5u1QRTvd --> |

## Why these are all built in <!-- id:e_fqk8Sk -->

`link` and `bytes` are primitives. The schema language does not define them. They have the same status `string` and `integer` already have. <!-- id:vRNfqKAc -->

The codec defines what a string is. The schema language only **names** the kind so a schema can constrain a field to it. `link` and `bytes` work the same way: the codec (DAG-CBOR) owns their existence and their wire form, and the schema language names them in the `type` vocabulary. The schema language has always been a set of names for codec-defined kinds, so adding two more names changes nothing structural. <!-- id:UiBqR_i_ -->

The practical rule, spelled out in [the schema language](./schema-language.md) and [encoding](./encoding.md): **never model the `{"/":…}` representation as a map inside a schema.** A link is its own kind that happens to _render_ as a map with a `/` key in [dag-json](./dag-json.md). Treat it as atomic and opaque, like a string. <!-- id:GVUZP-3T -->

## `integer` vs `float` <!-- id:3q3MXiRQ -->

JSON has one number type. DAG-CBOR has two, encoded with different major types. Merging them into one kind loses round-trip fidelity: a value written as `1.0` might re-encode as the integer `1`. So the data model keeps them distinct. <!-- id:RwgxMcHi -->

The weak spot is JavaScript and JSON, which cannot tell `3.0` from `3`. So the reference validator checks `integer` strictly (`Number.isInteger`) and accepts any number as `float`. A real DAG-CBOR pipeline keeps the distinction in the bytes, where it is unambiguous. <!-- id:clWBjXCZ -->

## `map` vs `struct`: one kind of data, two types <!-- id:MQy2plVQ -->

At the data-model level there is only `map`. DAG-CBOR has no separate object or struct kind. The schema language gives that one kind two types, because a map is used in two different ways: <!-- id:N8qkl2B3 -->
  - [`struct`](../struct.md): the keys are known field names, each with its own schema (`properties`). It is [closed](./closed-map.md) unless `values` opens it to extra keys. <!-- id:ubG-u-aL -->
  - [`map`](../map.md): the keys are data, and every value matches one schema (`values`). <!-- id:dFwJHUze -->

Both validate the same bytes. The type tells a form which fields to show, tells a validator which keys are stray, and tells a generated type whether to emit named members or an index signature. See [the schema language](./schema-language.md). <!-- id:Ig-D69Z- -->

## Links connect blocks <!-- id:vq_2Quam -->

A `link` is a [CID](../cid.md): a hash that names another block by its content. Links make Hypermedia data a **DAG** (directed acyclic graph) that spans many blocks. A schema field typed `link` says "here is a pointer to another block." It can also say "and that block's value should match schema X," which is a _typed link_ (see [references](./references.md) and [link-schema](./link-schema.md)). Examples: in `example/document`, `author` links to a person and `previous` links to another document. `example/folder` and `example/file` link to each other. <!-- id:iUJyyn7s -->

The schema language uses the same mechanism on itself. Schemas link to other schemas, so the type definitions form their own graph, addressed and resolved like the data they describe. <!-- id:0a8cB8Tw -->

## The primitive schemas: `/<kind>` <!-- id:QPx8_TmX -->

A kind like `string` is a _name in the vocabulary_. `{"type":"string"}` is the _schema_ for a string value. The library ships that schema as a canonical, named block, one per kind. These are the [primitives](./primitive.md): <!-- id:bmWAAKox -->

<!-- id:IRoeKmq3 -->
| primitive <!-- col:Khg0aF44 --> | is exactly <!-- col:y6M-JfyQ --> | typed by <!-- col:AADEz9yl --> <!-- id:5Ox6LZWF --> |
| --- | --- | --- |
| `null`, `boolean`, `integer`, `float`, `string`, `bytes` | `{ "type": "<kind>" }` | `schema/scalar-schema` <!-- id:idSfV3A2 --> |
| `link` | `{ "type": "link" }` | `schema/link-schema` <!-- id:VcOv81bN --> |
| `struct`, `map`, `list` | `{ "type": "<kind>" }` | `schema/struct-schema` / `schema/map-schema` / `schema/list-schema` <!-- id:zNbu4gjL --> |

These are the **standard library**. Keep two layers apart: <!-- id:zEmQScRC -->
  - [`schema/scalar-schema`](./scalar-schema.md) is a meta-schema [variant](./variant.md). It describes the _shape_ `{type:<scalar>, …constraints}`, so it is the **type of** `string`. <!-- id:FBr8EANM -->
  - `string` is a _primitive_: `{"type":"string"}`. It is an _instance_ of that shape, and it is the block you reference. <!-- id:3j_Fqm8i -->

A field names the primitive with `type`: `{ "type": "hm://…/string" }`. The URL both names the kind and points at the canonical `string` block. So **a field's type is itself a resolvable reference**, using the same mechanism as any other reference (see [references](./references.md) and [`hm://` URLs](../protocol/urls.md)). The example schemas all do this. In `example/person`, every field's `type` names a primitive or another schema. <!-- id:TvpKD4MG -->

# See also

- [The schema language](./schema-language.md): the keys that constrain these kinds.
- [Encoding](./encoding.md): how each kind is written in DAG-CBOR and dag-json.
- [References and naming](./references.md): includes, typed links and `hm://` names.
- [Kind](./kind.md): the term page.
- [Blobs](../protocol/blobs.md): DAG-CBOR and CIDs on the Hypermedia Network.
- [Design rationale](./design.md): why the kinds are split this way.
