---
name: Schema
summary: The meta-schema, which is the union of every shape a schema can take and a valid instance of itself, with a guide to schemas in the Seed app and an index of the reference pages.
schemaDefinition: ipfs://bafyreiblucqpfoylug6ex3anrhm66lvep4uyjd4ukh2d4iqolfeucc3gre
---
A **schema** is a value that constrains other values. It is either a map written with the [schema vocabulary](./schema/schema-language.md), or a bare [literal](./schema/literal-schema.md) (`"draft"`, `1`, `true`, `null`) that accepts exactly one value. Every schema is typed by the meta-schema and matches one of its variants. <!-- id:OzcV9e2b -->

The **meta-schema**, named `schema`, is the schema that describes what a schema is. It is a [discriminated union](./schema/discriminated-union.md) of nine map variants and four literal kinds. It [validates as an instance of itself](./schema/self-description.md). It is the one type in the system that is known without being looked up. <!-- id:bXl0LFcD -->

This page defines the meta-schema. Its formal schema is attached through the `schemaDefinition` key in this page's [metadata](./metadata.md), so the Seed app can show it and create values of this type. <!-- id:y93xpe-t -->

**Hypermedia Schemas are a type system for content-addressed data.** They type the [IPLD](./schema/ipld.md) and [DAG-CBOR](./schema/dag-cbor.md) values that Hypermedia [blocks](./protocol/blocks.md) and [blobs](./protocol/blobs.md) are built from. A schema is itself a DAG-CBOR object on IPFS, so schemas [reference](./schema/references.md) other schemas the same way data references data. <!-- id:YSBcigax -->

This page shows how to use Hypermedia Schemas in the [Seed app](./apps/desktop.md) and lists the reference pages. <!-- id:dyK3Cuof -->

# Start here <!-- id:jYC5B4_d -->

These pages explain the system from the top down: <!-- id:XwK2BBFL -->
  - [Hypermedia Schemas in one page](./schema/quick-reference.md): the model, the library by link, the three keys that type a document, and the CLI commands, SDK calls and agent verbs that read, write and check them. <!-- id:tk4m-_Cj -->
  - [Why Hypermedia Schemas](./schema/why.md): the problem they solve, what they make possible, and what they do not try to do. <!-- id:ASDj0A2q -->
  - [How Hypermedia Schemas work](./schema/how-it-works.md): the pipeline from a schema file to a signed blob, a browsable document, a resolved reference, a generated type and a typed API call. <!-- id:JnOo7Tmo -->
  - [Typed documents](./schema/typed-documents.md): how a [document](./protocol/documents.md) says what it is with `attributesSchema`, `childAttributesSchema` and `schemaDefinition`, and what the editor does with them. <!-- id:ejnPERZF -->
  - [The World Builder](./schema/world-builder.md): a worked demo that builds a set of linked types, with date pickers, title pills and linked objects on every page. <!-- id:JKC7fUPx -->
  - [Seed API schemas](./rpc.md): every read method of the [Seed API](./build/web-api.md) as a published schema, and the console the app builds from them. <!-- id:gnB4WgGS -->
  - [User stories](./schema/user-stories.md): what a person should be able to do through the app, the CLI and an agent, step by step, and how far each surface has come. <!-- id:xzhJgjsb -->

# In one minute <!-- id:sPmTq8Rq -->

- Every value is one of **nine [kinds](./schema/kind.md)**: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. [The data model](./schema/data-model.md) describes each one. <!-- id:Zyqnpby8 -->
- A **schema** is a `map` that constrains a value. Its keys are `type` (a kind, or another schema to [include](./schema/include-schema.md) or [extend](./schema/extension.md)), `properties` (one [property](./schema/property.md) per field, each with its own `required` flag), `items`, `values`, `target`, `anyOf`, the [generics](./schema/generic.md) keys `params`, `var` and `args`, and value constraints such as `minLength`, `pattern` and `minimum`. A bare **literal** (`"draft"`, `1`, `true`, `null`) accepts exactly that value, so a fixed set of choices is a [union](./schema/anyof.md) of literals. <!-- id:Jb3Yvg3p -->
- Schemas reference each other by **[hm:// URL](./protocol/urls.md)**. A name can take part in a cycle and a [content hash cannot](./schema/fixpoint-problem.md), so names let types recurse. <!-- id:KVkmtla5 -->
- Validation is **advisory** in the editors, which warn and never block, and **strict** in the reference validator. <!-- id:4a6RPK0p -->

# Using Hypermedia Schemas in the Seed app <!-- id:L_DgXvRt -->

Typed documents need no setting: any [document](./protocol/documents.md)'s **Attributes** tab shows its [schema bindings](./schema/typed-documents.md). The raw building blocks, **New Blob** and **New Schema**, need **Developer Mode**. Turn it on in Settings, Advanced, on desktop. It is on by default in the web app. Once it is on, a document's options menu shows both entries. <!-- id:5Fs6bCbF -->

## Browse the schemas <!-- id:aRoEaieX -->

Every schema is a page of this site, starting at the meta-schema on this page. In the Seed app, a [document](./protocol/documents.md) that defines a schema shows it above its body in the schema browser. A schema blob with no defining document opens on its own at `/hm/schema/<cid>`. <!-- id:vbG_WGq1 -->
  - The library covers the meta-schema, primitives, [examples](./example.md), the schemas of the network's signed blobs, and the [Seed API schemas](./rpc.md). <!-- id:Ic9Qwwbd -->
  - Each schema shows its fields with kinds and required flags, union variants, inherited and added fields for an extension, generic parameters, its published [`hm://` URL](./hm-url.md) and [CID](./protocol/blobs.md), and its source [dag-json](./schema/dag-json.md). <!-- id:K_Hww_2j -->
  - **Every reference is a link.** Click a field's type, a dependency, or an `hm://` value in the source to open that schema. Each page also lists what it depends on and what depends on it. <!-- id:U8TGynZc -->
  - A type's page offers **New Document** and **New Collection**. Its options menu adds **Extend Schema**, **New Raw Value** and **Inspect Schema**. Under an `rpc/<method>` schema, a live call panel runs that method against the app's [Seed API](./build/web-api.md). <!-- id:Lvsl4-lc -->

## Create a schema <!-- id:pGXQjMrq -->

Choose **New Schema** from the options menu. The editor opens against the meta-schema, so the form offers only choices a valid schema can make: pick a [kind](./schema/kind.md), add [properties](./schema/property.md), mark them required, add literals or unions. Publishing stores the schema as a content-addressed [blob](./protocol/blobs.md) that you can reference by CID or by name. <!-- id:ggmcQl7m -->

## Create typed data <!-- id:X0q30aDs -->

To start a value that matches a schema, choose **New Blob** for a blank [DAG-CBOR](./schema/dag-cbor.md) object, **New Raw Value** on a type's page, or **New Instance of this Schema** on a schema blob in the inspector. The editor follows the schema. It suggests the schema's fields, offers dropdowns for [unions of literals](./schema/literal-schema.md) and pickers for union [variants](./schema/variant.md), shows the right controls for `link` and `bytes`, and flags anything that does not match without blocking you. <!-- id:o1oySfG7 -->

## Type a document's metadata with a schema <!-- id:94quIzFe -->

A [document](./protocol/documents.md) names the type of its own [attributes](./metadata.md) with `attributesSchema`. A folder names the type of its children's attributes with `childAttributesSchema`. Both are bindings in the document's **Attributes** tab. The tab ends with a **Schema definition** section, where a document defines a schema of its own. Once a type applies, the tab follows it. Required fields show as fixed rows and optional ones as chips. Literal unions get dropdowns, dates get date pickers, and [`hm://` references](./protocol/urls.md) get search. A value that does not match gets a warning. [Typed documents](./schema/typed-documents.md) has the rules. <!-- id:d5xNGHyZ -->

## Inspect and validate <!-- id:bPbybkKJ -->

Open any IPFS [blob](./protocol/blobs.md) in the **inspector**. When the blob is a schema, the inspector offers **New Instance of this Schema**. When a DAG-CBOR blob links a schema, the inspector fetches the schema and checks the value against it, as a warning only. You can edit the blob as fields or as raw dag-json, and attach or change its schema. <!-- id:Z9K5k3Hw -->

# Schemas are hypermedia documents <!-- id:2ksHZHeX -->

A schema can be published as a normal Hypermedia [document](./protocol/documents.md) whose [metadata](./metadata.md) has a `schemaDefinition` key pointing at the schema [blob](./protocol/blobs.md) as `ipfs://<cid>`. Other schemas and documents then reference it by [`hm://` name](./protocol/urls.md), which is readable, versioned and resolvable. The [CID](./cid.md) pins the exact bytes. The type system is stored on the same network it types. <!-- id:lp-qJpvG -->

# Reference documentation <!-- id:XQr4-lP- -->

The concepts, in reading order: <!-- id:MLxtm7My -->
  1. [The data model](./schema/data-model.md): the nine kinds of value. <!-- id:_5H16K85 -->
  2. [The schema language](./schema/schema-language.md): the full vocabulary of closed maps, unions, generics, extension and value constraints, and how the language describes itself. <!-- id:dS1O-Jw6 -->
  3. [References & naming](./schema/references.md): include, typed link and extend, `hm://` names, and why names make recursion possible where hashes cannot. <!-- id:W-7l34pY -->
  4. [Encoding](./schema/encoding.md): DAG-CBOR, the `dag-json` human form, canonical encoding and the reserved-key envelopes. <!-- id:zc8wCFCX -->
  5. [Examples](./example.md): every example schema, grouped by feature. <!-- id:nslzTd6Z -->
  6. [Schemas on the Hypermedia Network](./schema/blobs.md): schemas for the network's DAG-CBOR blobs (Change, Ref, Profile and the rest), the block model including [tables](./block/table.md) and [query blocks](./block/query.md), and the `rpc/type/*` read models the daemon computes for clients, such as resources, [citations](./rpc/type/citation.md) and [search results](./rpc/type/search-results.md). <!-- id:SZlHsPnT -->
  7. [Design rationale](./schema/design.md): why the system has this shape, the decisions taken, and the open questions. <!-- id:ZHSf8L5M -->
  8. Terms: one page per definition, listed at the end of this page. <!-- id:lZdOYrQc -->

# The tooling <!-- id:IbNZWutg -->

The library's tools live in `scripts/hypermedia/` in the Seed repository. The reference validator has no dependencies. It proves the meta-schema [describes itself](./schema/self-description.md), validates every schema against it, and confirms the union rejects malformed schemas. The publisher hashes each schema to its [DAG-CBOR](./schema/dag-cbor.md) [CID](./cid.md). The TypeScript generator turns every schema into a TS type: maps become interfaces, literal unions become TS unions, [extension](./schema/extension.md) becomes intersection, and [`Change<Block>`](./change.md) becomes a TS [generic](./schema/generic.md). The registry generator bundles the library for the apps. The Seed app runs a port of the same validator, so its schema browser and editors agree with the reference validator. The [Seed CLI](./build/cli.md), the [SDK](./build/sdk.md) and [Seed Agents](./agent.md) use the same engine from `@seed-hypermedia/client`. <!-- id:-VNyXPT9 -->

# Shape <!-- id:4QWuviLU -->

A **union**: a value matches one of these variants. <!-- id:r_pDx306 -->
  - [struct-schema](./schema/struct-schema.md) <!-- id:JDZD3hmG -->
  - [map-schema](./schema/map-schema.md) <!-- id:8o35KJdz -->
  - [list-schema](./schema/list-schema.md) <!-- id:Q3vpoo1- -->
  - [scalar-schema](./schema/scalar-schema.md) <!-- id:XcNAJyGU -->
  - [link-schema](./schema/link-schema.md) <!-- id:vq_S_Dm7 -->
  - [include-schema](./schema/include-schema.md) <!-- id:ZjHtnpFj -->
  - [union-schema](./schema/anyof.md) <!-- id:n9qz4ea3 -->
  - [var-schema](./schema/var-schema.md) <!-- id:VY7nFwdc -->
  - [literal-schema](./schema/literal-schema.md) <!-- id:KZ3BNjsi -->
  - [string](./string.md): a bare string is a literal schema <!-- id:yqpTFSKq -->
  - [integer](./integer.md): a bare integer is a literal schema <!-- id:c3PPOXHO -->
  - [boolean](./boolean.md): a bare boolean is a literal schema <!-- id:-cxXCWv7 -->
  - [null](./null.md): null is a literal schema <!-- id:6_sGlZ9l -->

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
- [struct-schema](./schema/struct-schema.md) <!-- id:dM0DU7X5 -->
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

# See also

- [Typed documents](./schema/typed-documents.md): how a document names its schema.
- [References and naming](./schema/references.md): why schemas point at each other by name.
- [Examples](./example.md): every example schema, grouped by feature.
- [Metadata](./metadata.md): the attribute keys that bind a document to a schema.
- [Blobs](./protocol/blobs.md): the signed DAG-CBOR objects the network stores.
- [Documents](./protocol/documents.md): the pages schemas are published as.
- [URLs](./protocol/urls.md): the `hm://` names schemas use.
- [Seed API schemas](./rpc.md): the read methods as published schemas.
