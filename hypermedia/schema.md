---
name: Schema
summary: "The meta-schema: a discriminated union of the shapes a schema can take, and a valid instance of itself — how to browse, author and validate schemas in the Seed app, plus the full reference documentation."
schemaDefinition: ipfs://bafyreiblucqpfoylug6ex3anrhm66lvep4uyjd4ukh2d4iqolfeucc3gre
---
**Schema** — a value of kind `map` that constrains other values, written with the twelve-key vocabulary — or a bare literal (`"draft"`, `1`, `true`, `null`) that accepts exactly one value. Every schema is itself typed by the meta-schema, and is one of the meta-schema's variants. <!-- id:OzcV9e2b -->

**Meta-schema** — `schema`: the schema that describes what a schema is. A **discriminated union** of nine map variants and the four literal kinds; a valid instance of itself, and the system's axiom — the one block whose type is known out of band. <!-- id:bXl0LFcD -->

This document describes the **schema** type — the meta-schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:y93xpe-t -->

**A self-describing type system for content-addressed data.** Hypermedia Schemas type the IPLD / DAG-CBOR values that Hypermedia blocks are built from. A schema is itself a DAG-CBOR block on IPFS, so schemas reference other schemas the same way data references data — and the schema that describes what a schema is validates as an instance of itself. <!-- id:YSBcigax -->

This page is a practical guide to _using_ Hypermedia Schemas inside the Seed app, and an index to the full reference documentation below. <!-- id:dyK3Cuof -->

# Start here <!-- id:jYC5B4_d -->

New to Hypermedia Schemas? These four pages explain the system from the top down before the reference chapters go deep: <!-- id:XwK2BBFL -->
  - [Hypermedia Schemas in one page](./doc/schema/quick-reference.md) — the condensed reference: the model, the library by link, the three document-typing keys, and the exact CLI commands, SDK calls, and agent verbs that read, write, and check them. <!-- id:tk4m-_Cj -->
  - [Why Hypermedia Schemas](./doc/schema/why.md) — the problem it solves, what it makes possible, and what it deliberately is not. <!-- id:ASDj0A2q -->
  - [How Hypermedia Schemas work](./doc/schema/how-it-works.md) — the whole pipeline, from a schema file to a signed blob, a browsable document, a resolved reference, a generated type, and a typed API call. <!-- id:JnOo7Tmo -->
  - [Typed documents](./schema/typed-documents.md) — how a document declares what it is with `attributesSchema`, `childAttributesSchema`, and `schemaDefinition`, and what the editor does about it. <!-- id:ejnPERZF -->
  - [The World Builder](./doc/world-builder.md) — a worked demo: scaffold an ontology of types that reference each other, with date pickers, title pills, and linked objects in every page. <!-- id:JKC7fUPx -->
  - [The typed API](./rpc.md) — every read method of the Seed API as a published schema, and the console generated from them. <!-- id:gnB4WgGS -->
  - [User stories](./doc/schema/user-stories.md) — what a person should be able to do with all of this through the app, the CLI, and an agent, step by step, and where each surface stands. <!-- id:xzhJgjsb -->

# In one minute <!-- id:sPmTq8Rq -->

- Every value is one of **nine kinds**: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. <!-- id:Zyqnpby8 -->
- A **schema** is a `map` that constrains a value — `type` (naming a kind, or another schema to include or extend), `properties` (each field a property carrying its own `required` flag), `items`, `values`, `target`, `anyOf`, generics (`params` / `var` / `args`), and value constraints (`minLength`, `pattern`, `minimum`, …) — or a bare **literal** (`"draft"`, `1`, `true`, `null`) that accepts exactly that value; a fixed set of choices is a union of literals. <!-- id:Jb3Yvg3p -->
- Schemas reference each other by **`hm://` name**, not by content hash — that is what lets types recurse and form cycles. <!-- id:KVkmtla5 -->
- Validation is **advisory** in the editors (warn, don't block) and **strict** in the reference validator. <!-- id:4a6RPK0p -->

# Using Hypermedia Schemas in the Seed app <!-- id:L_DgXvRt -->

The schema features live behind **Developer Mode** (Settings → Developers on desktop; on by default on web). Once enabled, every document's options menu gains the building-block entries below. <!-- id:5Fs6bCbF -->

## Browse the schemas <!-- id:aRoEaieX -->

Every schema is a page of this site (start at [the meta-schema](./schema.md)), and in the app any schema blob opens in the schema browser at `/hm/schema/<cid>`. For the whole library on one local site, `node scripts/hypermedia/tour.mjs` serves the tour, a browsable view of the whole type system: <!-- id:vbG_WGq1 -->
  - A catalog of every schema, grouped into the meta-schema, primitives, examples, and the Hypermedia network's real blob schemas. <!-- id:Ic9Qwwbd -->
  - Each schema renders as a page: its fields (with kinds and required/optional), union variants, extension (inherited vs added fields), generic parameters, its published `hm://` URL and CID, and its source `dag-json`. <!-- id:K_Hww_2j -->
  - **Every reference is a link.** Types are documents: click a field's type, a dependency, or an `hm://` value in the source to navigate to that schema. Each page also lists what it _depends on_ and what _depends on it_. <!-- id:U8TGynZc -->
  - Under each schema is a **live editor** — build a value of that schema (or, on the meta-schema, build a _schema_) and watch it validate on every keystroke, by the same engine as the reference validator. <!-- id:Lvsl4-lc -->

## Create a schema <!-- id:pGXQjMrq -->

Choose **New Schema** from the options menu. This opens the editor pointed at the meta-schema, so the form itself only offers choices a valid schema can make — pick a kind, add properties, mark them required, add literals or unions. Publishing mints a content-addressed schema blob you can reference by CID or name. <!-- id:ggmcQl7m -->

## Create typed data <!-- id:X0q30aDs -->

Choose **New Blob** for a blank DAG-CBOR object, or **New Instance** (from a schema's page in the inspector) to start a value pre-seeded to match a schema. The editor is _schema-respecting_: it suggests the schema's fields, offers dropdowns for unions of literals and pickers for union variants, renders `link` and `bytes` with the right controls, and flags anything that doesn't conform — without blocking you. <!-- id:o1oySfG7 -->

## Type a document's metadata with a schema <!-- id:94quIzFe -->

In a document's **Attributes** editor, attach a schema as a field: click the schema-field button (or type a schema's `ipfs://…` URL as the field's name). The field then becomes schema-driven — dropdowns for literal unions, search-assisted inputs for `hm://` references, and advisory warnings when a value doesn't match. <!-- id:d5xNGHyZ -->

## Inspect and validate <!-- id:bPbybkKJ -->

Open any IPFS blob in the **inspector**. It recognizes the six signed Hypermedia blob types (a badge naming the type: Change, Comment, …), detects when a blob _is_ a schema (offering **New Instance**), and — when a blob carries an attached schema — fetches it and shows **✓ matches schema** or a count of advisory warnings. From there you can **Edit** a DAG-CBOR blob or open its schema. <!-- id:Z9K5k3Hw -->

# Schemas are hypermedia documents <!-- id:2ksHZHeX -->

A schema can be published as a normal Hypermedia document whose metadata carries a `schemaDefinition` pointing (`ipfs://<cid>`) at the immutable schema blob. Everything then references schemas by **`hm://` name** — human, versioned, resolvable — while the CID pins the exact bytes. This is how the type system dogfoods the network it types. <!-- id:lp-qJpvG -->

# Reference documentation <!-- id:XQr4-lP- -->

The concepts, in reading order: <!-- id:MLxtm7My -->
  1. [The data model](./schema/data-model.md) — the nine kinds of value. <!-- id:_5H16K85 -->
  2. [The schema language](./schema/schema-language.md) — the full vocabulary: closed maps, unions, generics, extension, value constraints, and how the language describes itself. <!-- id:dS1O-Jw6 -->
  3. [References & naming](./schema/references.md) — include / typed link / extend, `hm://` names, and why names (not hashes) make recursion possible. <!-- id:W-7l34pY -->
  4. [Encoding](./schema/encoding.md) — DAG-CBOR, the `dag-json` human form, canonical encoding, and the reserved-key envelopes. <!-- id:zc8wCFCX -->
  5. [Examples](./example.md) — a catalog of every example schema, grouped by feature. <!-- id:nslzTd6Z -->
  6. [Schemas on the Hypermedia Network](./schema/blobs.md) — schemas for the network's real DAG-CBOR blobs (Change, Ref, Profile, …), the full block model including [tables](./block/table.md) and [live queries](./block/query.md), and the `rpc/type/*` read models — the derived data the daemon computes for clients (resources, [citations](./rpc/type/citation.md), [search results](./rpc/type/search-results.md), …). <!-- id:SZlHsPnT -->
  7. [Design rationale](./doc/schema/design.md) — why the system is shaped this way, the decisions taken, and the open questions. <!-- id:ZHSf8L5M -->
  8. Terms — one page per definition, listed at the end of this page. <!-- id:lZdOYrQc -->

# Under the hood <!-- id:IbNZWutg -->

The library ships a dependency-free reference validator that proves the meta-schema describes itself, validates every schema against it, and confirms the union _rejects_ malformed schemas; a deterministic publisher that hashes each schema to its DAG-CBOR CID; a TypeScript generator that turns every schema into a TS type (maps become interfaces, enums become literal unions, extension becomes intersection, and `Change<Block>` becomes a real TS generic); and a schema explorer that renders every schema as a page. That same validator is ported into the Seed app, so the in-app tour and editors can never disagree with the reference oracle. <!-- id:-VNyXPT9 -->

# Shape <!-- id:4QWuviLU -->

A **union** — a value matches one of these variants: <!-- id:r_pDx306 -->
  - [map-schema](./schema/map-schema.md) <!-- id:8o35KJdz -->
  - [list-schema](./schema/list-schema.md) <!-- id:Q3vpoo1- -->
  - [scalar-schema](./schema/scalar-schema.md) <!-- id:XcNAJyGU -->
  - [link-schema](./schema/link-schema.md) <!-- id:vq_S_Dm7 -->
  - [include-schema](./schema/include-schema.md) <!-- id:ZjHtnpFj -->
  - [union-schema](./schema/anyof.md) <!-- id:n9qz4ea3 -->
  - [var-schema](./schema/var-schema.md) <!-- id:VY7nFwdc -->
  - [literal-schema](./schema/literal-schema.md) <!-- id:KZ3BNjsi -->
  - [string](./string.md) — a bare string is a literal schema <!-- id:yqpTFSKq -->
  - [integer](./integer.md) — a bare integer is a literal schema <!-- id:c3PPOXHO -->
  - [boolean](./boolean.md) — a bare boolean is a literal schema <!-- id:-cxXCWv7 -->
  - [null](./null.md) — null is a literal schema <!-- id:6_sGlZ9l -->

# Depends on <!-- id:_7aiQPhA -->

- [boolean](./boolean.md) <!-- id:ReFegJmw -->
- [include-schema](./schema/include-schema.md) <!-- id:sgBDWijw -->
- [integer](./integer.md) <!-- id:xEEWZo_C -->
- [link-schema](./schema/link-schema.md) <!-- id:A4p8bq5A -->
- [list-schema](./schema/list-schema.md) <!-- id:wC1FNIlK -->
- [literal-schema](./schema/literal-schema.md) <!-- id:7GZkoLpS -->
- [map-schema](./schema/map-schema.md) <!-- id:G0zPLoYK -->
- [null](./null.md) <!-- id:DOl7wGGz -->
- [scalar-schema](./schema/scalar-schema.md) <!-- id:6GlNvB4Q -->
- [string](./string.md) <!-- id:wRRFFgG5 -->
- [union-schema](./schema/anyof.md) <!-- id:GFJNvn_u -->
- [var-schema](./schema/var-schema.md) <!-- id:hRHhpE13 -->

# Terms <!-- id:g0hNqX_Z -->

- [Kind](./schema/kind.md) <!-- id:jAaKSJhR -->
- [Discriminated union](./schema/discriminated-union.md) <!-- id:J59mZ_xm -->
- [Variant](./schema/variant.md) <!-- id:U_8ZZLK1 -->
- [`anyOf`](./schema/anyof.md) <!-- id:OEIBJ8uy -->
- [Literal](./schema/literal-schema.md) <!-- id:iqoj9WTF -->
- [Generic](./schema/generic.md) <!-- id:gHpr96Jy -->
- [Primitive](./schema/primitive.md) <!-- id:ghSoMqHP -->
- [Closed map](./schema/closed-map.md) <!-- id:pvknBu3Z -->
- [Self-description](./schema/self-description.md) <!-- id:ZbJSiz4A -->
- [Include](./schema/include-schema.md) <!-- id:EpvyP-7m -->
- [Extension](./schema/extension.md) <!-- id:i1lLDrLX -->
- [Link](./link.md) <!-- id:4KhfYjTN -->
- [CID](./cid.md) <!-- id:bNc7y4MR -->
- [IPLD](./schema/ipld.md) <!-- id:krhXfVp5 -->
- [DAG-CBOR](./schema/dag-cbor.md) <!-- id:A-K8gv95 -->
- [dag-json](./schema/dag-json.md) <!-- id:CSSu6CL3 -->
- [Envelope](./schema/envelope.md) <!-- id:CrT14VO3 -->
- [`hm://` URL](./hm-url.md) <!-- id:pvOG8a9_ -->
- [Authority](./authority.md) <!-- id:lYfyQQFk -->
- [Fixpoint problem](./schema/fixpoint-problem.md) <!-- id:RrdTbHMw -->
- [Canonical encoding](./schema/canonical-encoding.md) <!-- id:usb9xHLx -->
- [Struct](./struct.md) <!-- id:GKgCZDN3 -->
