---
name: Onyx
summary: A self-describing type system for content-addressed data — how to browse, author, and validate schemas in the Seed app, plus the full reference documentation.
---

# Onyx

**A self-describing type system for content-addressed data.** Onyx types the IPLD / DAG-CBOR values that Hypermedia blocks are built from. A schema is itself a DAG-CBOR block on IPFS, so schemas reference other schemas the same way data references data — and the schema that describes what a schema is validates as an instance of itself.

This page is a practical guide to *using* Onyx inside the Seed app, and an index to the full reference documentation below.

## In one minute

- Every value is one of **nine kinds**: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`.
- A **schema** is a `map` that constrains a value — `type`, `properties`, `required`, `items`, `values`, `enum`, `ref`, `anyOf`, generics (`params` / `var` / `args`), and value constraints (`minLength`, `pattern`, `minimum`, …).
- Schemas reference each other by **`hm://` name**, not by content hash — that is what lets types recurse and form cycles.
- Validation is **advisory** in the editors (warn, don't block) and **strict** in the reference validator.

## Using Onyx in the Seed app

The schema features live behind **Developer Mode** (Settings → Developers on desktop; on by default on web). Once enabled, every document's options menu gains the building-block entries below.

### Browse the schema tour

Open **Onyx Schema Tour** from any document's options menu (or visit `/hm/onyx`). The tour is a browsable, in-app view of the whole type system:

- A catalog of every schema, grouped into the meta-schema, primitives, examples, and the Hypermedia network's real blob schemas.
- Each schema renders as a page: its fields (with kinds and required/optional), union variants, extension (inherited vs added fields), generic parameters, its published `hm://` URL and CID, and its source `dag-json`.
- **Every reference is a link.** Types are documents: click a field's type, a dependency, or an `hm://` value in the source to navigate to that schema. Each page also lists what it *depends on* and what *depends on it*.
- Under each schema is a **live editor** — build a value of that schema (or, on the meta-schema, build a *schema*) and watch it validate on every keystroke, by the same engine as the reference validator.

### Create a schema

Choose **New Schema** from the options menu. This opens the editor pointed at the meta-schema, so the form itself only offers choices a valid schema can make — pick a kind, add properties, mark them required, add enums or unions. Publishing mints a content-addressed schema blob you can reference by CID or name.

### Create typed data

Choose **New Blob** for a blank DAG-CBOR object, or **New Instance** (from a schema's page in the inspector) to start a value pre-seeded to match a schema. The editor is *schema-respecting*: it suggests the schema's fields, offers dropdowns for enums and union variants, renders `link` and `bytes` with the right controls, and flags anything that doesn't conform — without blocking you.

### Type a document's metadata with a schema

In a document's **Attributes** editor, attach a schema as a field: click the schema-field button (or type a schema's `ipfs://…` URL as the field's name). The field then becomes schema-driven — dropdowns for literal unions, search-assisted inputs for `hm://` references, and advisory warnings when a value doesn't match.

### Inspect and validate

Open any IPFS blob in the **inspector**. It recognizes the six signed Hypermedia blob types (an "Onyx: Change / Comment / …" badge), detects when a blob *is* a schema (offering **New Instance**), and — when a blob carries an attached schema — fetches it and shows **✓ matches schema** or a count of advisory warnings. From there you can **Edit** a DAG-CBOR blob or open its schema.

## Schemas are hypermedia documents

A schema can be published as a normal Hypermedia document whose metadata carries a `schemaDefinition` pointing (`ipfs://<cid>`) at the immutable schema blob. Everything then references schemas by **`hm://` name** — human, versioned, resolvable — while the CID pins the exact bytes. This is how the type system dogfoods the network it types.

## Reference documentation

The concepts, in reading order:

1. [The data model](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/data-model) — the nine kinds of value.
2. [The schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language) — the full vocabulary: closed maps, unions, generics, extension, value constraints, and how Onyx describes itself.
3. [References & naming](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references) — include / typed link / extend, `hm://` names, and why names (not hashes) make recursion possible.
4. [Encoding](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/encoding) — DAG-CBOR, the `dag-json` human form, canonical encoding, and the reserved-key envelopes.
5. [Examples](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/examples) — a catalog of every example schema, grouped by feature.
6. [Onyx on the Hypermedia Network](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia) — schemas for the network's real DAG-CBOR blobs (Change, Ref, Profile, …).
7. [Design rationale](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/design) — why the system is shaped this way, the decisions taken, and the open questions.
8. [Glossary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/glossary) — every term in one place.

## Under the hood

Onyx ships a dependency-free reference validator that proves the meta-schema describes itself, validates every schema against it, and confirms the union *rejects* malformed schemas; a deterministic publisher that hashes each schema to its DAG-CBOR CID; and a schema explorer that renders every schema as a page. That same validator is ported into the Seed app, so the in-app tour and editors can never disagree with the reference oracle.
