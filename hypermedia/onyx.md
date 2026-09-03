---
name: Onyx
summary: A self-describing type system for content-addressed data — how to browse, author, and validate schemas in the Seed app, plus the full reference documentation.
---
**A self-describing type system for content-addressed data.** Onyx types the IPLD / DAG-CBOR values that Hypermedia blocks are built from. A schema is itself a DAG-CBOR block on IPFS, so schemas reference other schemas the same way data references data — and the schema that describes what a schema is validates as an instance of itself. <!-- id:YSBcigax -->

This page is a practical guide to _using_ Onyx inside the Seed app, and an index to the full reference documentation below. <!-- id:dyK3Cuof -->

# Start here <!-- id:jYC5B4_d -->

New to Onyx? These four pages explain the system from the top down before the reference chapters go deep: <!-- id:XwK2BBFL -->
  - [Why Onyx](./why.md) — the problem it solves, what it makes possible, and what it deliberately is not. <!-- id:ASDj0A2q -->
  - [How Onyx works](./how-it-works.md) — the whole pipeline, from a schema file to a signed blob, a browsable document, a resolved reference, a generated type, and a typed API call. <!-- id:JnOo7Tmo -->
  - [Typed documents](./typed-documents.md) — how a document declares what it is with `schema`, `childrenSchema`, and `schemaDefinition`, and what the editor does about it. <!-- id:ejnPERZF -->
  - [The World Builder](./world-builder.md) — a worked demo: scaffold an ontology of types that reference each other, with date pickers, title pills, and linked objects in every page. <!-- id:JKC7fUPx -->
  - [The typed API](./api.md) — every read method of the Seed API as a published schema, and the console generated from them. <!-- id:gnB4WgGS -->

# In one minute <!-- id:sPmTq8Rq -->

- Every value is one of **nine kinds**: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. <!-- id:Zyqnpby8 -->
- A **schema** is a `map` that constrains a value — `type`, `properties`, `required`, `items`, `values`, `enum`, `ref`, `anyOf`, generics (`params` / `var` / `args`), and value constraints (`minLength`, `pattern`, `minimum`, …). <!-- id:Jb3Yvg3p -->
- Schemas reference each other by **`hm://` name**, not by content hash — that is what lets types recurse and form cycles. <!-- id:KVkmtla5 -->
- Validation is **advisory** in the editors (warn, don't block) and **strict** in the reference validator. <!-- id:4a6RPK0p -->

# Using Onyx in the Seed app <!-- id:L_DgXvRt -->

The schema features live behind **Developer Mode** (Settings → Developers on desktop; on by default on web). Once enabled, every document's options menu gains the building-block entries below. <!-- id:5Fs6bCbF -->

## Browse the schema tour <!-- id:aRoEaieX -->

Open **Onyx Schema Tour** from any document's options menu (or visit `/hm/onyx`). The tour is a browsable, in-app view of the whole type system: <!-- id:vbG_WGq1 -->
  - A catalog of every schema, grouped into the meta-schema, primitives, examples, and the Hypermedia network's real blob schemas. <!-- id:Ic9Qwwbd -->
  - Each schema renders as a page: its fields (with kinds and required/optional), union variants, extension (inherited vs added fields), generic parameters, its published `hm://` URL and CID, and its source `dag-json`. <!-- id:K_Hww_2j -->
  - **Every reference is a link.** Types are documents: click a field's type, a dependency, or an `hm://` value in the source to navigate to that schema. Each page also lists what it _depends on_ and what _depends on it_. <!-- id:U8TGynZc -->
  - Under each schema is a **live editor** — build a value of that schema (or, on the meta-schema, build a _schema_) and watch it validate on every keystroke, by the same engine as the reference validator. <!-- id:Lvsl4-lc -->

## Create a schema <!-- id:pGXQjMrq -->

Choose **New Schema** from the options menu. This opens the editor pointed at the meta-schema, so the form itself only offers choices a valid schema can make — pick a kind, add properties, mark them required, add enums or unions. Publishing mints a content-addressed schema blob you can reference by CID or name. <!-- id:ggmcQl7m -->

## Create typed data <!-- id:X0q30aDs -->

Choose **New Blob** for a blank DAG-CBOR object, or **New Instance** (from a schema's page in the inspector) to start a value pre-seeded to match a schema. The editor is _schema-respecting_: it suggests the schema's fields, offers dropdowns for enums and union variants, renders `link` and `bytes` with the right controls, and flags anything that doesn't conform — without blocking you. <!-- id:o1oySfG7 -->

## Type a document's metadata with a schema <!-- id:94quIzFe -->

In a document's **Attributes** editor, attach a schema as a field: click the schema-field button (or type a schema's `ipfs://…` URL as the field's name). The field then becomes schema-driven — dropdowns for literal unions, search-assisted inputs for `hm://` references, and advisory warnings when a value doesn't match. <!-- id:d5xNGHyZ -->

## Inspect and validate <!-- id:bPbybkKJ -->

Open any IPFS blob in the **inspector**. It recognizes the six signed Hypermedia blob types (an "Onyx: Change / Comment / …" badge), detects when a blob _is_ a schema (offering **New Instance**), and — when a blob carries an attached schema — fetches it and shows **✓ matches schema** or a count of advisory warnings. From there you can **Edit** a DAG-CBOR blob or open its schema. <!-- id:Z9K5k3Hw -->

# Schemas are hypermedia documents <!-- id:2ksHZHeX -->

A schema can be published as a normal Hypermedia document whose metadata carries a `schemaDefinition` pointing (`ipfs://<cid>`) at the immutable schema blob. Everything then references schemas by **`hm://` name** — human, versioned, resolvable — while the CID pins the exact bytes. This is how the type system dogfoods the network it types. <!-- id:lp-qJpvG -->

# Reference documentation <!-- id:XQr4-lP- -->

The concepts, in reading order: <!-- id:MLxtm7My -->
  1. [The data model](./data-model.md) — the nine kinds of value. <!-- id:_5H16K85 -->
  2. [The schema language](./schema-language.md) — the full vocabulary: closed maps, unions, generics, extension, value constraints, and how Onyx describes itself. <!-- id:dS1O-Jw6 -->
  3. [References & naming](./references.md) — include / typed link / extend, `hm://` names, and why names (not hashes) make recursion possible. <!-- id:W-7l34pY -->
  4. [Encoding](./encoding.md) — DAG-CBOR, the `dag-json` human form, canonical encoding, and the reserved-key envelopes. <!-- id:zc8wCFCX -->
  5. [Examples](./examples.md) — a catalog of every example schema, grouped by feature. <!-- id:nslzTd6Z -->
  6. [Onyx on the Hypermedia Network](./hypermedia.md) — schemas for the network's real DAG-CBOR blobs (Change, Ref, Profile, …), the full block model including [tables](./hypermedia-block-table.md) and [live queries](./hypermedia-block-query.md), and the `seed-*` read models — the derived data the daemon computes for clients (resources, [citations](./seed-citation.md), [search results](./seed-search-results.md), …). <!-- id:SZlHsPnT -->
  7. [Design rationale](./design.md) — why the system is shaped this way, the decisions taken, and the open questions. <!-- id:ZHSf8L5M -->
  8. [Glossary](./glossary.md) — every term in one place. <!-- id:lZdOYrQc -->

# Under the hood <!-- id:IbNZWutg -->

Onyx ships a dependency-free reference validator that proves the meta-schema describes itself, validates every schema against it, and confirms the union _rejects_ malformed schemas; a deterministic publisher that hashes each schema to its DAG-CBOR CID; a TypeScript generator that turns every schema into a TS type (maps become interfaces, enums become literal unions, extension becomes intersection, and `Change<Block>` becomes a real TS generic); and a schema explorer that renders every schema as a page. That same validator is ported into the Seed app, so the in-app tour and editors can never disagree with the reference oracle. <!-- id:-VNyXPT9 -->
<!-- end:IbNZWutg -->

<./sprout-resource.md> <!-- id:ATdZ9MA6WT type:Embed attrs:{"view":"Card"} -->
