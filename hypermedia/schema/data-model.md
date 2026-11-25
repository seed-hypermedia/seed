---
name: Data Model
summary: Every Hypermedia value is one of nine kinds, such as string, list, map and link, and this page lists them and the ready-made schema for each.
---
Every value in Hypermedia is one of **nine [kinds](./kind.md)**: null, boolean, integer, float, string, bytes, list, map or link. A value is exactly one of them. For example, `"hi"` is a string, `[1, 2]` is a list, and `{"a": 1}` is a map. [Hypermedia Schemas](../schema.md) describe values built from these kinds.

The nine kinds come from the **[IPLD](./ipld.md) data model**. They are the kinds that [DAG-CBOR](./dag-cbor.md), the binary format of the network, can encode. <!-- id:geSDK1S_ -->

<!-- id:a8BD2izY -->
| kind <!-- col:HbgVvtTb --> | JSON / dag-json form <!-- col:FqheG8jM --> | notes <!-- col:bWMpxxLR --> <!-- id:OvMqcdvO --> |
| --- | --- | --- |
| `null` | `null` | <!-- id:IBoVXWo- --> |
| `boolean` | `true` / `false` | <!-- id:RwAQFxQi --> |
| `integer` | `42` | DAG-CBOR encodes integers and floats **differently** <!-- id:cVihAylW --> |
| `float` | `3.14` | <!-- id:1cgFWZ3X --> |
| `string` | `"hi"` | UTF-8 text <!-- id:V5tUQxNr --> |
| `bytes` | `{"/":{"bytes":"aGVsbG8"}}` | raw bytes; written as base64 in dag-json <!-- id:e1LXXg47 --> |
| `list` | `[…]` | values in order <!-- id:A4hk_Kp6 --> |
| `map` | `{…}` | keys are strings, and each key appears once <!-- id:3jxicrAc --> |
| `link` | `{"/":"bafy…"}` | a **[CID](../cid.md)**: a pointer to another [blob](../protocol/blobs.md), made from the hash of its bytes <!-- id:5u1QRTvd --> |

# Why these are all built in <!-- id:e_fqk8Sk -->

`link` and `bytes` are built in. The schema language does not define them. They stand beside `string` and `integer` as equals. <!-- id:vRNfqKAc -->

The encoding decides what a string, a link or a byte string is. The schema language only gives each one a name, so a schema can ask for it. DAG-CBOR decides that links and bytes exist and how they are written. The schema language names them as values of `type`, and adds no structure of its own. <!-- id:UiBqR_i_ -->

The rule to follow: **never describe the `{"/":…}` form as a map inside a schema.** A link is its own kind. It only _looks_ like a map with a `/` key when written in [dag-json](./dag-json.md). Treat it as one whole value, like a string. [The schema language](./schema-language.md) and [encoding](./encoding.md) say more. <!-- id:GVUZP-3T -->

# `integer` vs `float` <!-- id:3q3MXiRQ -->

JSON has one number type. DAG-CBOR has two, and it encodes them differently. If the data model merged them, a value could change when it is read and written again: `1.0` could come back as the integer `1`. So the data model keeps them apart. <!-- id:RwgxMcHi -->

JavaScript and JSON cannot tell `3.0` from `3`. So the validator checks `integer` strictly: the number must have no fraction. It accepts any number as `float`. In DAG-CBOR bytes the two are always different, so nothing is lost there. <!-- id:clWBjXCZ -->

# `map` vs `struct`: one kind of data, two types <!-- id:MQy2plVQ -->

In the data model there is only `map`. DAG-CBOR has no separate object or struct kind. The schema language gives that one kind two types, because people use a map in two ways: <!-- id:N8qkl2B3 -->
  - [`struct`](../struct.md): the keys are known field names, and each has its own schema (`properties`). It is [closed](./closed-map.md), unless `values` opens it to extra keys. <!-- id:ubG-u-aL -->
  - [`map`](../map.md): the keys are data, and every value matches one schema (`values`). <!-- id:dFwJHUze -->

Both check the same bytes. The type tells a form which fields to show. It tells a validator which keys do not belong. It tells generated code whether to write named members or an index signature. See [the schema language](./schema-language.md). <!-- id:Ig-D69Z- -->

# Links connect blobs <!-- id:vq_2Quam -->

A `link` is a [CID](../cid.md): a hash that names another blob by its content. With links, Hypermedia data becomes a graph that spans many blobs. A link can only point at a blob that already exists, so the graph has no loops. Such a graph is called a **DAG** (directed acyclic graph).

A schema field typed `link` says "here is a pointer to another blob". It can also say "and the value of that blob should match schema X". That is a _typed link_ (see [references](./references.md) and [link-schema](./link-schema.md)). In `example/document`, `author` links to a person, and `previous` links to an earlier value of the same type. `example/folder` and `example/file` link to each other. <!-- id:iUJyyn7s -->

Schemas use the same idea on themselves. A schema refers to other schemas, so the type definitions form their own graph. <!-- id:0a8cB8Tw -->

# The primitive schemas: `/<kind>` <!-- id:QPx8_TmX -->

A kind such as `string` is a _name_. `{"type":"string"}` is the _schema_ for a string value. The library holds that schema ready-made, one per kind, plus `struct`, the second type for a map. These are the [primitives](./primitive.md): <!-- id:bmWAAKox -->

<!-- id:IRoeKmq3 -->
| primitive <!-- col:Khg0aF44 --> | is exactly <!-- col:y6M-JfyQ --> | typed by <!-- col:AADEz9yl --> <!-- id:5Ox6LZWF --> |
| --- | --- | --- |
| [`null`](../null.md), [`boolean`](../boolean.md), [`integer`](../integer.md), [`float`](../float.md), [`string`](../string.md), [`bytes`](../bytes.md) | `{ "type": "<kind>" }` | `schema/scalar-schema` <!-- id:idSfV3A2 --> |
| [`link`](../link.md) | `{ "type": "link" }` | `schema/link-schema` <!-- id:VcOv81bN --> |
| [`struct`](../struct.md), [`map`](../map.md), [`list`](../list.md) | `{ "type": "<kind>" }`, or `{ "type": "struct" }` | `schema/struct-schema` / `schema/map-schema` / `schema/list-schema` <!-- id:zNbu4gjL --> |

The whole library is built on these. [The catalogue of types](./types.md) lists everything built on them. Keep two layers apart: <!-- id:zEmQScRC -->
  - [`schema/scalar-schema`](./scalar-schema.md) is a [variant](./variant.md) of the [meta-schema](../schema.md). It describes the _shape_ `{type:<scalar>, …constraints}`, so it is the **type of** `string`. <!-- id:FBr8EANM -->
  - `string` is a _primitive_: `{"type":"string"}`. It is one schema that has that shape, and it is the schema you refer to. <!-- id:3j_Fqm8i -->

A field names the primitive with `type`: `{ "type": "hm://…/string" }`. The URL names the kind, and it also points at the ready-made `string` schema. So **a field's type is itself a reference you can follow**, like any other reference (see [references](./references.md) and [`hm://` URLs](../protocol/urls.md)). The example schemas all do this. In `example/person`, the `type` of every field names a primitive or another schema. <!-- id:TvpKD4MG -->

# See also <!-- id:KB-QRRj5 -->

- [The schema language](./schema-language.md): the keys that constrain these kinds. <!-- id:xB0P0p89 -->
- [Encoding](./encoding.md): how each kind is written in DAG-CBOR and dag-json. <!-- id:b7BtkRZD -->
- [References and naming](./references.md): includes, typed links and `hm://` names. <!-- id:MmGY78pk -->
- [Kind](./kind.md): the term page. <!-- id:BzBEYIZs -->
- [Blobs](../protocol/blobs.md): DAG-CBOR and CIDs on the Hypermedia Network. <!-- id:SV22Aevk -->
- [The rationale](./why.md): why the kinds are split this way. <!-- id:9ZubrEvc -->
- [The catalogue of types](./types.md): every value type and protocol type in the library.
