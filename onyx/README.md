# Onyx

**A self-describing type system for content-addressed data — and how Seed
documents bind to it.**

Onyx is a minimal schema language for typing IPLD / DAG-CBOR data. It is small
enough to describe *itself*: the schema that defines what a schema is
([`onyx-schema.json`](./onyx-schema.json)) is a valid instance of that very
schema — a **discriminated union of seven variants** (the seven shapes a schema
can take) that validates as its own `union` variant. Because Onyx schemas are
themselves DAG-CBOR blocks, the meta-schema ends up referencing itself by its own
name. The type system is its own first citizen.

This folder is the whole Onyx library: the type schemas, example values, a
human-readable doc per concept, and the narrative chapters. Everything here is
also **published to Hypermedia** under the onyx account
`z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb`
([browse it](https://hyper.media/hm/z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb)).

Two forms of the same thing:

| | Human form (this folder) | Published form (Hypermedia) |
| --- | --- | --- |
| encoding | JSON files | DAG-CBOR blocks |
| references | file names (`onyx-string.json`) | `hm://` doc URLs (`hm://z6MkmZUb…/string`) |
| owned by | — | a signing authority (a public key) |
| audience | people editing schemas | machines resolving & typing data |

You author in the left column. Both `ref` and `type` values are **`hm://` doc
URLs** under the onyx account — every reference is a real, clickable, published
document, so a type is never a dead placeholder. The public name strips the
`onyx-` prefix from primitives/meta (`hm://z6MkmZUb…/map`, `/string`, `/schema`)
and keeps the `hypermedia-` / `example-` prefix otherwise
(`hm://z6MkmZUb…/hypermedia-metadata`, `/example-person`). Names — not content
hashes — are what let schemas **recurse** and reference each other in cycles; a
CID is pinned to exact bytes and can't. See [references.md](./references.md).

---

## How a document binds to a schema

Onyx types the *values*. This section is how a **Hypermedia document** declares
what it is. A document may carry three distinct schema-related metadata fields —
all declared on the **base document** schema
([`hypermedia-document.json`](./hypermedia-document.json)):

| field | meaning | value |
| --- | --- | --- |
| **`schema`** | the schema **this** document conforms to | a schema-doc `hm://` URL, or `ipfs://<cid>` |
| **`childrenSchema`** | the schema this document's **children** must conform to | a schema-doc `hm://` URL, or `ipfs://<cid>` |
| **`schemaDefinition`** | this document **defines/describes** a schema (so others reference it by URL) | `ipfs://<cid>` of a schema blob |

The last one was the biggest early misunderstanding: **`schemaDefinition` does
NOT mean "this document conforms to a schema."** A document that *describes* a
type (e.g. a "Person" doc at `hm://acme/person`) sets `schemaDefinition` to the
person schema blob. Another document *conforms* by setting `schema:
hm://acme/person` — which resolves through that doc's `schemaDefinition` to the
actual schema. A **value** (an employee record like "bob") is not a type: it sets
`schema`, never `schemaDefinition`.

**Base document.** Every typed document schema **extends**
`hm://z6MkmZUb…/hypermedia-document` — a map of `{ metadata, content }` where
`content` is the block-node tree ([`hypermedia-block-node.json`](./hypermedia-block-node.json))
and `metadata` is [`hypermedia-metadata.json`](./hypermedia-metadata.json) (which
carries the three fields above). A typed schema refines the nested `metadata`
(e.g. requires an extra field) — see [`example-person-doc.json`](./example-person-doc.json),
which requires `metadata.surname`.

**Child inheritance.** A document's **effective** conformance schema is its own
`schema`, or — if absent — its parent's `childrenSchema`. A child that declares
its own `schema` must descend from the base document **and** the parent's
`childrenSchema`.

**References everywhere.** A schema reference (`schema`, `childrenSchema`, an
`extends` ref, a map-property or list-item subschema) can be an ipfs CID, a
bundled library URL (`hm://z6MkmZUb…/map`, resolved locally), or an arbitrary
Hypermedia document URL (`hm://acct/path`, fetched → that doc's
`schemaDefinition` → the blob).

**Worked example** (the model end-to-end):
1. A schema blob extends `hm://z6MkmZUb…/hypermedia-document` and requires a
   `surname` in `metadata`.
2. `hm://acme/person` describes what a person is and sets `schemaDefinition` to
   that CID — now "person" has a URL.
3. `hm://acme/people` sets `childrenSchema: hm://acme/person`.
4. Every child (`hm://acme/people/bob`) conforms; at the top of both the Content
   and Attributes tabs, the required `surname` field is always visible.

**Errors are guardrails, not gates.** Out-of-spec metadata/content surfaces as
**red, non-blocking** UI (which field, what rule) — the user can always still
save invalid content.

The full design + phased implementation notes live in
[`../notes/onyx-schema-model-v2.md`](../notes/onyx-schema-model-v2.md).

---

## In the Seed app

The type system is ported into the app (`frontend/packages/ui/src/onyx/`) so
schema-authoring, browsing, and validation never disagree with the reference
validator:

- **Engine** (`onyx-engine.ts`) — a TS port of [`validate.mjs`](./validate.mjs);
  bundles every schema + the CID manifest; resolves a CID or `hm://` URL to a
  schema with no fetch when it's bundled.
- **Resolution** (`onyx-schema-resolve.tsx`) — `useResolvedSchema` (CID /
  bundled URL / fetched document URL) and `useEffectiveDocSchema` (own `schema`
  else parent `childrenSchema`).
- **Required attributes** — the conformance schema's required custom fields are
  always-visible editable rows, at the top of the **Attributes** tab and **above
  the body** in the **Content** tab; they can't be removed.
- **Red validation** — a per-field badge + a summary banner flag out-of-spec data.
- **Schema-definition documents** get a header **tag** that opens the schema and
  a **Create** button that opens the schema-defined value editor and publishes a
  new IPFS blob.
- **Explorer / data editor** — browse any schema and build a conforming value
  (reachable via the `/hm/onyx` route and the dev-mode "Onyx Schema Tour" menu).

## Publishing

Every `onyx/<name>.json` has a co-located, hand-authorable `onyx/<name>.md`
explaining the concept. `frontend/apps/cli/src/sync-onyx.ts` publishes, under the
onyx account: every schema blob (CIDs verified against `schemas.lock.json`), plus
one document per schema at its public name — a **type** doc gets
`schemaDefinition` = its CID; an **instance** doc (`{$type, value}`) gets
`schema` = its `$type`. Narrative pages come from `onyx/site/`.

```sh
node scripts/gen-onyx-site.mjs          # scaffold any missing onyx/<name>.md (--force to regenerate)
cd frontend/apps/cli && bun run src/sync-onyx.ts --dry-run   # preview
cd frontend/apps/cli && bun run src/sync-onyx.ts             # publish to hyper.media
```

---

## The knowledge base

Read in order, or jump to what you need:

1. **[data-model.md](./data-model.md)** — the nine kinds of value (the IPLD data model, incl. `link` and `bytes`).
2. **[schema-language.md](./schema-language.md)** — the vocabulary: closed maps, unions, generics, extension, and how Onyx describes itself as a discriminated union.
3. **[references.md](./references.md)** — `include` / `link` / extend, the `hm://` naming layer, and how names (not hashes) make recursion possible.
4. **[encoding.md](./encoding.md)** — DAG-CBOR, the dag-json human form, canonical encoding, and the reserved-key envelopes.
5. **[examples.md](./examples.md)** — a catalog of every example schema, grouped by feature and linked to the tests.
6. **[hypermedia.md](./hypermedia.md)** — Onyx on real data: schemas for the Hypermedia Network's DAG-CBOR blobs (Change, Ref, Profile, …).
7. **[design-rationale.md](./design-rationale.md)** — why the system is shaped this way, the decisions taken, and the open questions.
8. **[glossary.md](./glossary.md)** — terms in one place.

Plus the schema-binding design + phases: **[../notes/onyx-schema-model-v2.md](../notes/onyx-schema-model-v2.md)**.

## The files

| file | what it is |
| --- | --- |
| [`onyx-schema.json`](./onyx-schema.json) | the meta-schema — a discriminated union of the **seven** variants below |
| [`onyx-map-schema.json`](./onyx-map-schema.json) | variant: a `map` schema (struct / open map) |
| [`onyx-list-schema.json`](./onyx-list-schema.json) | variant: a `list` schema |
| [`onyx-scalar-schema.json`](./onyx-scalar-schema.json) | variant: a scalar schema (null/boolean/integer/float/string/bytes) |
| [`onyx-link-schema.json`](./onyx-link-schema.json) | variant: a `link` schema (typed CID) |
| [`onyx-include-schema.json`](./onyx-include-schema.json) | variant: a bare `ref` include |
| [`onyx-union-schema.json`](./onyx-union-schema.json) | variant: an `anyOf` union |
| [`onyx-var-schema.json`](./onyx-var-schema.json) | variant: a `var` type-variable (for generics) |
| `onyx-<kind>.json` | the **primitive library** — one canonical schema per kind (`onyx-string`, `onyx-boolean`, … each just `{ "type": <kind-url> }`) |
| [`hypermedia-document.json`](./hypermedia-document.json) | the **base document** every typed document schema extends: `{ metadata, content }` |
| [`hypermedia-metadata.json`](./hypermedia-metadata.json) | document metadata — carries `schema` / `childrenSchema` / `schemaDefinition` |
| [`hypermedia-block-node.json`](./hypermedia-block-node.json) | a content-tree node (a block + its children) |
| `hypermedia-*.json` | **Hypermedia Network blob schemas** — Change, Ref, Profile, Comment, Capability, Contact + their shared base, ops, and metadata (see [hypermedia.md](./hypermedia.md)) |
| `example-*.json` | **example schemas & values** covering every feature — see the full catalog in [examples.md](./examples.md) |
| `<name>.md` | the co-located human doc published alongside each schema |
| [`validate.mjs`](./validate.mjs) | dependency-free reference validator (250+ checks) |
| [`tour.mjs`](./tour.mjs) | the zero-dependency explorer server (`node tour.mjs`) |
| [`publish.mjs`](./publish.mjs) | hashes each schema to its DAG-CBOR CID → `schemas.lock.json` (`node publish.mjs`) |
| `schemas.lock.json` | the published manifest: every `hm://` URL → its content CID |

## Try it

```sh
node validate.mjs                                  # prove onyx-schema.json validates itself
node validate.mjs example-person.json data.json    # validate a data file against a schema
node tour.mjs                                       # browse the library locally
```
