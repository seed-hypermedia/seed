---
name: Schema
summary: The meta-schema, which is the union of every shape a schema can take and a valid instance of itself, and the starting point for every page about Hypermedia Schemas.
---
A **schema** is a value that constrains other values. It is either a map written with the [schema vocabulary](./schema/schema-language.md), or a bare [literal](./schema/literal-schema.md) (`"draft"`, `1`, `true`, `null`) that accepts exactly one value. Every schema is typed by the meta-schema and matches one of its variants. <!-- id:OzcV9e2b -->

The **meta-schema**, named `schema`, is the schema that describes what a schema is. It is a [discriminated union](./schema/discriminated-union.md) of nine map variants and four literal kinds. It [validates as an instance of itself](./schema/self-description.md). It is the one type in the system that is known without being looked up. <!-- id:bXl0LFcD -->

This page defines the meta-schema. Its formal schema is attached through the `schemaDefinition` key in this page's [metadata](./metadata.md), so the Seed app can show it and create values of this type. It is also the home of the Hypermedia Schemas pages, listed below. <!-- id:y93xpe-t -->

# Hypermedia Schemas in brief <!-- id:sPmTq8Rq -->

**Hypermedia Schemas are a type system for content-addressed data.** They type the [IPLD](./schema/ipld.md) and [DAG-CBOR](./schema/dag-cbor.md) values that Hypermedia [blocks](./protocol/blocks.md) and [blobs](./protocol/blobs.md) are built from. A schema is itself a DAG-CBOR object on IPFS, so schemas [reference](./schema/references.md) other schemas the same way data references data. <!-- id:YSBcigax -->

- Every value is one of **nine [kinds](./schema/kind.md)**: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. <!-- id:Zyqnpby8 -->
- A **schema** names a kind or another schema with `type`, and every other key refines what it names: `properties` for the fields of a struct, `items` for a list, `values` for a map, `anyOf` for a union, and value constraints such as `minLength` and `pattern`. A fixed set of choices is a [union](./schema/anyof.md) of literals. <!-- id:Jb3Yvg3p -->
- Schemas reference each other by **[hm:// URL](./protocol/urls.md)**. A name can take part in a cycle and a [content hash cannot](./schema/fixpoint-problem.md), so names let types recurse. <!-- id:KVkmtla5 -->
- A schema can be published as a normal Hypermedia [document](./protocol/documents.md) whose [metadata](./metadata.md) has a `schemaDefinition` key pointing at the schema [blob](./protocol/blobs.md) as `ipfs://<cid>`. Other schemas and documents then reference it by name, and the [CID](./cid.md) pins the exact bytes. The type system is stored on the same network it types. <!-- id:lp-qJpvG -->
- Validation is **advisory** in the editors, which warn and never block, and **strict** in the validator, the CLI's checks and an agent's blob writes. <!-- id:4a6RPK0p -->

# Where to read next <!-- id:XQr4-lP- -->

Read the concepts in this order: <!-- id:MLxtm7My -->
  1. [The data model](./schema/data-model.md): the nine kinds of value. Read it first. <!-- id:_5H16K85 -->
  2. [The schema language](./schema/schema-language.md): the complete reference for the vocabulary, with closed structs, unions, generics, extension and value constraints, and how the language describes itself. <!-- id:dS1O-Jw6 -->
  3. [References and naming](./schema/references.md): include, typed link and extend, `hm://` names, how a reference resolves, and why names make recursion possible where hashes cannot. <!-- id:W-7l34pY -->
  4. [Encoding](./schema/encoding.md): DAG-CBOR, the dag-json form people read, canonical encoding and a schema's CID. <!-- id:zc8wCFCX -->

Then go to the page for what you want to do:
  - [Typed documents](./schema/typed-documents.md): how a [document](./protocol/documents.md) says what it is with `attributesSchema`, `childAttributesSchema` and `schemaDefinition`, and what the editor does with them. <!-- id:ejnPERZF -->
  - [Typing a blob](./schema/typing-a-blob.md): how a raw DAG-CBOR object links to its schema, with a worked example.
  - [Schemas on the Hypermedia Network](./schema/blobs.md): how schemas type the signed blobs (Change, Ref, Profile and the rest) and the block model, and how to define a signed blob type or a block type of your own. <!-- id:SZlHsPnT -->
  - [The catalogue of types](./schema/types.md): every type in the library with one line each. Use it to find a type's page.
  - [Examples](./example.md): every example schema, grouped by the feature it shows. <!-- id:nslzTd6Z -->
  - [Schema workflows](./schema/workflows.md) and [typed blob workflows](./schema/blob-workflows.md): the steps for each task in the Seed app, the CLI and through an agent, including what turns the schema menus on. <!-- id:xzhJgjsb -->
  - [The World Builder](./schema/world-builder.md): a worked demo that builds a set of linked types, with date pickers, title pills and linked objects on every page. <!-- id:JKC7fUPx -->
  - [Why Schemas](./schema/why.md): the problem they solve, the principles and decisions behind the language, and what it does not try to do. <!-- id:ASDj0A2q -->
  - [The schema library pipeline](./schema/library-pipeline.md): for contributors, how the Seed repository validates, pins, publishes and bundles the library.

# Terms <!-- id:g0hNqX_Z -->

Each term has a short page of its own. <!-- id:lZdOYrQc -->

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
- [Envelope](./schema/envelope.md), the dag-json spelling of a link or bytes <!-- id:CrT14VO3 -->
- [`hm://` URL](./hm-url.md) <!-- id:pvOG8a9_ -->
- [Authority](./authority.md) <!-- id:lYfyQQFk -->
- [Fixpoint problem](./schema/fixpoint-problem.md) <!-- id:RrdTbHMw -->
- [Canonical encoding](./schema/canonical-encoding.md) <!-- id:usb9xHLx -->
- [Struct](./struct.md) <!-- id:GKgCZDN3 -->

# See also <!-- id:W4A1iB0e -->

- [Metadata](./metadata.md): the attribute keys that bind a document to a schema. <!-- id:IH68O-Ib -->
- [Blobs](./protocol/blobs.md): the signed DAG-CBOR objects the network stores. <!-- id:CjHSu5e6 -->
- [Documents](./protocol/documents.md): the pages schemas are published as. <!-- id:Qdt4-Z3B -->
- [URLs](./protocol/urls.md): the `hm://` names schemas use. <!-- id:UM9fUhzV -->

# Start with these <!-- id:zv09spuF attrs:{"childrenType":"Grid","columnCount":3} -->

<./schema/why.md> <!-- id:UE8RS2f7 type:Embed attrs:{"view":"Card"} -->

<./schema/schema-language.md> <!-- id:6CLM8V3W type:Embed attrs:{"view":"Card"} -->

<./schema/data-model.md> <!-- id:TRqWA4sY type:Embed attrs:{"view":"Card"} -->

<./schema/typed-documents.md> <!-- id:2Ehd3kO2 type:Embed attrs:{"view":"Card"} -->

<./schema/typing-a-blob.md> <!-- id:XBpuXMpu type:Embed attrs:{"view":"Card"} -->

<./schema/types.md> <!-- id:dUem3kLa type:Embed attrs:{"view":"Card"} -->

<./schema/workflows.md> <!-- id:NvzEEEHA type:Embed attrs:{"view":"Card"} -->

<./schema/blob-workflows.md> <!-- id:fyv5Q0S1 type:Embed attrs:{"view":"Card"} -->

<./schema/references.md> <!-- id:603ICTex type:Embed attrs:{"view":"Card"} -->

<./schema/encoding.md> <!-- id:dDpiudv9 type:Embed attrs:{"view":"Card"} -->

<./schema/blobs.md> <!-- id:N3NYvP91 type:Embed attrs:{"view":"Card"} -->

<./schema/world-builder.md> <!-- id:mbS7luSr type:Embed attrs:{"view":"Card"} -->

<./schema/library-pipeline.md> <!-- id:0swbtVtt type:Embed attrs:{"view":"Card"} -->

# The schema variants <!-- id:p8ZyVGKG attrs:{"childrenType":"Grid","columnCount":3} -->

<./schema/struct-schema.md> <!-- id:gQdS7lnc type:Embed attrs:{"view":"Card"} -->

<./schema/map-schema.md> <!-- id:NocnWATv type:Embed attrs:{"view":"Card"} -->

<./schema/list-schema.md> <!-- id:LUc4uULQ type:Embed attrs:{"view":"Card"} -->

<./schema/scalar-schema.md> <!-- id:uWiCvnoM type:Embed attrs:{"view":"Card"} -->

<./schema/link-schema.md> <!-- id:nf8sO13Q type:Embed attrs:{"view":"Card"} -->

<./schema/include-schema.md> <!-- id:lwayfgqc type:Embed attrs:{"view":"Card"} -->

<./schema/anyof.md> <!-- id:9dlizr93 type:Embed attrs:{"view":"Card"} -->

<./schema/var-schema.md> <!-- id:qgcfHOYx type:Embed attrs:{"view":"Card"} -->

<./schema/literal-schema.md> <!-- id:6s12DKh0 type:Embed attrs:{"view":"Card"} -->

<./schema/property.md> <!-- id:C6NHhVqa type:Embed attrs:{"view":"Card"} -->

# Terms <!-- id:AjEpwQS7 attrs:{"childrenType":"Grid","columnCount":3} -->

<./schema/kind.md> <!-- id:IqmYfomq type:Embed attrs:{"view":"Card"} -->

<./schema/primitive.md> <!-- id:BqFg8yGR type:Embed attrs:{"view":"Card"} -->

<./schema/variant.md> <!-- id:AILFVvW3 type:Embed attrs:{"view":"Card"} -->

<./schema/discriminated-union.md> <!-- id:h3tUjy2t type:Embed attrs:{"view":"Card"} -->

<./schema/closed-map.md> <!-- id:3pzNC9XR type:Embed attrs:{"view":"Card"} -->

<./schema/self-description.md> <!-- id:YEPNjy2x type:Embed attrs:{"view":"Card"} -->

<./schema/extension.md> <!-- id:3Ob6je0Z type:Embed attrs:{"view":"Card"} -->

<./schema/generic.md> <!-- id:rGG7Qany type:Embed attrs:{"view":"Card"} -->

<./schema/fixpoint-problem.md> <!-- id:rqcjFKXm type:Embed attrs:{"view":"Card"} -->

<./schema/ipld.md> <!-- id:IPLKr6FA type:Embed attrs:{"view":"Card"} -->

<./schema/dag-cbor.md> <!-- id:iD44hWEo type:Embed attrs:{"view":"Card"} -->

<./schema/dag-json.md> <!-- id:QdJ1FwLR type:Embed attrs:{"view":"Card"} -->

<./schema/envelope.md> <!-- id:p9JdRLWd type:Embed attrs:{"view":"Card"} -->

<./schema/canonical-encoding.md> <!-- id:N2Gd4M8r type:Embed attrs:{"view":"Card"} -->
