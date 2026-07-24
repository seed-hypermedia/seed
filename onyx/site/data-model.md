---
name: The Onyx Data Model
summary: The nine IPLD kinds every Onyx value is built from — including link and bytes as first-class primitives.
---

# The Onyx data model

Onyx types values drawn from the **IPLD data model** — the same set of kinds
DAG-CBOR can encode. There are **nine kinds**. Every value is exactly one of
them; there is nothing else.

| kind | JSON / dag-json form | notes |
| --- | --- | --- |
| `null` | `null` | |
| `boolean` | `true` / `false` | |
| `integer` | `42` | DAG-CBOR encodes ints and floats **differently** |
| `float` | `3.14` | |
| `string` | `"hi"` | UTF-8 text |
| `bytes` | `{"/":{"bytes":"aGVsbG8"}}` | raw octets; base64 in dag-json |
| `list` | `[…]` | ordered sequence |
| `map` | `{…}` | keys are strings; ordered, unique |
| `link` | `{"/":"bafy…"}` | a **CID** — a content-addressed pointer to another block |

## Why these are all *built-in*

A recurring question when adopting IPLD: are `link` and `bytes` special types
we define in the schema language, or primitives? **Primitives.** And this is
not a new decision — it is the *same* status `string` and `integer` already
have.

Nothing in Onyx defines what a string *is*; the codec does. Onyx only **names**
the kind so a schema can constrain a field to it. `link` and `bytes` are
identical in standing: the codec (DAG-CBOR) owns their existence and their wire
form, and Onyx simply names them in the `type` vocabulary. The schema language
has *always* been a set of names for codec-defined kinds. Two more names
changes nothing structural.

The practical consequence, spelled out in [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language)
and [encoding](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/encoding): **never model the `{"/":…}` representation as
a map inside a schema.** A link is not "a map with a `/` key" — it is its own
kind that merely *renders* that way in JSON. Treat it as atomic and opaque,
exactly like a string.

## `integer` vs `float`

JSON has one number type; DAG-CBOR has two, encoded with different major types.
If you collapse them into one Onyx kind you lose round-trip fidelity: a value
authored as `1.0` might re-encode as the integer `1`. So Onyx keeps them
distinct.

The seam is JavaScript/JSON, which cannot tell `3.0` from `3`. The reference
validator therefore treats `integer` strictly (`Number.isInteger`) and `float`
permissively (any number). A real DAG-CBOR pipeline preserves the distinction
in the bytes, where it is unambiguous.

## `map` vs `struct` — one kind, two constraints

At the **data-model** level there is only `map`. There is no separate "object"
or "struct" kind. "Struct" is a *schema-level* idea: a map whose keys are known
in advance. Onyx expresses both shapes over the single `map` kind:

- known, named fields → constrain with `properties` (struct-like)
- arbitrary keys, uniform values → constrain with `values` (open map)

See [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language). This is why the vocabulary has
no `object` type: the kind is `map`, and *how* you constrain it is a separate
axis.

## `link` is the whole point

A `link` is a CID: a hash that names another block by its content. Links are
what make Onyx data a **DAG** (directed acyclic graph) spanning many blocks
rather than one document. A schema field typed `link` says "here is a pointer
to another block," and — optionally — "whose value should itself match schema
X" (a *typed link*; see [references](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references)). See
`example-document` (`author` links to a person,
`previous` to another document) and the mutually-linked
`example-folder` / `example-file`.

Onyx uses this same machinery on itself: schemas link to other schemas, so the
type definitions form their own DAG, addressed and resolved exactly like the
data they describe.

## The primitive schemas — `onyx-<kind>`

A kind like `string` is a *name in the vocabulary*; `{"type":"string"}` is the
*schema* for a string value. Onyx ships that schema as a canonical, named block —
one per kind:

| primitive | is exactly | typed by |
| --- | --- | --- |
| `onyx-null`, `onyx-boolean`, `onyx-integer`, `onyx-float`, `onyx-string`, `onyx-bytes` | `{ "type": "<kind>" }` | `onyx-scalar-schema` |
| `onyx-link` | `{ "type": "link" }` | `onyx-link-schema` |
| `onyx-map`, `onyx-list` | `{ "type": "<kind>" }` | `onyx-map-schema` / `onyx-list-schema` |

These are the **standard library**. Two layers, not to be confused:

- `onyx-scalar-schema` (a meta-schema *variant*) describes the *shape* `{type:<scalar>, enum?}` — it is the **type of** `onyx-string`.
- `onyx-string` (a *primitive*) is `{"type":"string"}` — an *instance* of that shape, and the block you actually reference.

Instead of inlining `{"type":"string"}` in every schema, reference the primitive:
`{ "ref": "onyx-string" }`. On IPFS that `ref` becomes the CID of the
`onyx-string` block, so **a field's type is itself a content-addressed link** —
the same mechanism as any other reference ([references](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references)). The
example schemas do exactly this; open `example-person` and every
field is a `ref` to a primitive or another schema.
