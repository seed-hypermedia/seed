---
name: The Onyx Data Model
summary: The nine IPLD kinds every Onyx value is built from — including link and bytes as first-class primitives.
---
# The Onyx data model <!-- id:1K3uAm_K -->
Onyx types values drawn from the **IPLD data model** — the same set of kinds DAG-CBOR can encode. There are **nine kinds**. Every value is exactly one of them; there is nothing else. <!-- id:geSDK1S_ -->

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
| `link` | `{"/":"bafy…"}` | a **CID** — a content-addressed pointer to another block <!-- id:5u1QRTvd --> |

## Why these are all _built-in_ <!-- id:e_fqk8Sk -->
A recurring question when adopting IPLD: are `link` and `bytes` special types we define in the schema language, or primitives? **Primitives.** And this is not a new decision — it is the _same_ status `string` and `integer` already have. <!-- id:vRNfqKAc -->

Nothing in Onyx defines what a string _is_; the codec does. Onyx only **names** the kind so a schema can constrain a field to it. `link` and `bytes` are identical in standing: the codec (DAG-CBOR) owns their existence and their wire form, and Onyx simply names them in the `type` vocabulary. The schema language has _always_ been a set of names for codec-defined kinds. Two more names changes nothing structural. <!-- id:UiBqR_i_ -->

The practical consequence, spelled out in [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language) and [encoding](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/encoding): **never model the `{"/":…}` representation as a map inside a schema.** A link is not "a map with a `/` key" — it is its own kind that merely _renders_ that way in JSON. Treat it as atomic and opaque, exactly like a string. <!-- id:GVUZP-3T -->

## `integer` vs `float` <!-- id:3q3MXiRQ -->
JSON has one number type; DAG-CBOR has two, encoded with different major types. If you collapse them into one Onyx kind you lose round-trip fidelity: a value authored as `1.0` might re-encode as the integer `1`. So Onyx keeps them distinct. <!-- id:RwgxMcHi -->

The seam is JavaScript/JSON, which cannot tell `3.0` from `3`. The reference validator therefore treats `integer` strictly (`Number.isInteger`) and `float` permissively (any number). A real DAG-CBOR pipeline preserves the distinction in the bytes, where it is unambiguous. <!-- id:clWBjXCZ -->

## `map` vs `struct` — one kind, two constraints <!-- id:MQy2plVQ -->
At the **data-model** level there is only `map`. There is no separate "object" or "struct" kind. "Struct" is a _schema-level_ idea: a map whose keys are known in advance. Onyx expresses both shapes over the single `map` kind: <!-- id:N8qkl2B3 -->
  - known, named fields → constrain with `properties` (struct-like) <!-- id:ubG-u-aL -->
  - arbitrary keys, uniform values → constrain with `values` (open map) <!-- id:dFwJHUze -->

See [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language). This is why the vocabulary has no `object` type: the kind is `map`, and _how_ you constrain it is a separate axis. <!-- id:Ig-D69Z- -->

## `link` is the whole point <!-- id:vq_2Quam -->
A `link` is a CID: a hash that names another block by its content. Links are what make Onyx data a **DAG** (directed acyclic graph) spanning many blocks rather than one document. A schema field typed `link` says "here is a pointer to another block," and — optionally — "whose value should itself match schema X" (a _typed link_; see [references](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references)). See `example-document` (`author` links to a person, `previous` to another document) and the mutually-linked `example-folder` / `example-file`. <!-- id:iUJyyn7s -->

Onyx uses this same machinery on itself: schemas link to other schemas, so the type definitions form their own DAG, addressed and resolved exactly like the data they describe. <!-- id:0a8cB8Tw -->

## The primitive schemas — `onyx-<kind>` <!-- id:QPx8_TmX -->
A kind like `string` is a _name in the vocabulary_; `{"type":"string"}` is the _schema_ for a string value. Onyx ships that schema as a canonical, named block — one per kind: <!-- id:bmWAAKox -->

<!-- id:IRoeKmq3 -->
| primitive <!-- col:Khg0aF44 --> | is exactly <!-- col:y6M-JfyQ --> | typed by <!-- col:AADEz9yl --> <!-- id:5Ox6LZWF --> |
| --- | --- | --- |
| `onyx-null`, `onyx-boolean`, `onyx-integer`, `onyx-float`, `onyx-string`, `onyx-bytes` | `{ "type": "<kind>" }` | `onyx-scalar-schema` <!-- id:idSfV3A2 --> |
| `onyx-link` | `{ "type": "link" }` | `onyx-link-schema` <!-- id:VcOv81bN --> |
| `onyx-map`, `onyx-list` | `{ "type": "<kind>" }` | `onyx-map-schema` / `onyx-list-schema` <!-- id:zNbu4gjL --> |

These are the **standard library**. Two layers, not to be confused: <!-- id:zEmQScRC -->
  - `onyx-scalar-schema` (a meta-schema _variant_) describes the _shape_ `{type:<scalar>, enum?}` — it is the **type of** `onyx-string`. <!-- id:FBr8EANM -->
  - `onyx-string` (a _primitive_) is `{"type":"string"}` — an _instance_ of that shape, and the block you actually reference. <!-- id:3j_Fqm8i -->

Instead of inlining `{"type":"string"}` in every schema, reference the primitive: `{ "ref": "onyx-string" }`. On IPFS that `ref` becomes the CID of the `onyx-string` block, so **a field's type is itself a content-addressed link** — the same mechanism as any other reference ([references](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references)). The example schemas do exactly this; open `example-person` and every field is a `ref` to a primitive or another schema. <!-- id:TvpKD4MG -->