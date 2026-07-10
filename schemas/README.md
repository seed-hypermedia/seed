# Onyx

**A self-describing type system for content-addressed data.**

Onyx is a minimal schema language for typing IPLD / DAG-CBOR data. It is small
enough to describe *itself* — the schema that defines what a schema is
([`onyx-schema.json`](./onyx-schema.json)) is a valid instance of that very schema. That
schema is a **discriminated union** of six variants (the six shapes a schema can
take), and it validates as its own `union` variant. Because Onyx schemas are
themselves DAG-CBOR blocks on IPFS, the meta-schema ends up referencing itself
*by its own CID*. The type system is its own first citizen.

Two forms of the same thing:

| | Human form (this repo) | Published form (Hypermedia) |
| --- | --- | --- |
| encoding | JSON files | DAG-CBOR blocks |
| references | file names (`"onyx-schema.json"`) | `hm://` URLs (`hm://hyper.media/schema`) |
| owned by | — | a signing authority (a public key) |
| audience | people editing schemas | machines resolving & typing data |

You author in the left column. Both `ref` and `type` values are **`hm://` URLs**
— names owned by a signing authority — so every type is clickable and
self-explanatory (`type` is `"hm://hyper.media/map"`, not a bare `"map"`). Local
filenames are just their dev alias (`onyx-string.json` ⇄ `hm://hyper.media/string`).
Names (not content hashes) are what let schemas **recurse** and reference each
other in cycles; a CID is pinned to exact bytes and can't. See
[references.md](./references.md).

## The knowledge base

Read in order, or jump to what you need:

1. **[data-model.md](./data-model.md)** — the nine kinds of value (the IPLD data model, incl. `link` and `bytes`).
2. **[schema-language.md](./schema-language.md)** — the vocabulary: closed maps, unions, generics, extension, and how Onyx describes itself as a discriminated union.
3. **[references.md](./references.md)** — `include` / `link` / extend, the `hm://` naming layer, and how names (not hashes) make recursion possible.
4. **[encoding.md](./encoding.md)** — DAG-CBOR, the dag-json human form, canonical encoding, and the reserved-key envelopes.
5. **[examples.md](./examples.md)** — a catalog of every example schema, grouped by feature and linked to the tests.
6. **[design-rationale.md](./design-rationale.md)** — why the system is shaped this way, the decisions taken, and the open questions.
7. **[glossary.md](./glossary.md)** — terms in one place.

## The files

| file | what it is |
| --- | --- |
| [`onyx-schema.json`](./onyx-schema.json) | the meta-schema — a discriminated union of the six variants below |
| [`onyx-map-schema.json`](./onyx-map-schema.json) | variant: a `map` schema (struct / open map) |
| [`onyx-list-schema.json`](./onyx-list-schema.json) | variant: a `list` schema |
| [`onyx-scalar-schema.json`](./onyx-scalar-schema.json) | variant: a scalar schema (null/boolean/integer/float/string/bytes) |
| [`onyx-link-schema.json`](./onyx-link-schema.json) | variant: a `link` schema (typed CID) |
| [`onyx-include-schema.json`](./onyx-include-schema.json) | variant: a bare `ref` include |
| [`onyx-union-schema.json`](./onyx-union-schema.json) | variant: an `anyOf` union |
| `onyx-<kind>.json` | the **primitive library** — one canonical schema per kind (`onyx-string`, `onyx-boolean`, … each just `{ "type": <kind-url> }`) |
| `example-*.json` | ~15 **example schemas** covering every feature — see the full catalog in [examples.md](./examples.md) |
| [`validate.mjs`](./validate.mjs) | dependency-free reference validator (100+ checks) |
| [`tour.mjs`](./tour.mjs) | the zero-dependency explorer server (`node tour.mjs`) |

## Try it

```sh
node validate.mjs                          # prove onyx-schema.json validates itself
node validate.mjs example-person.json data.json    # validate a data file against a schema
```
