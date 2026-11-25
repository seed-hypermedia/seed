---
name: Schema
summary: The meta-schema, which is the union of every shape a schema can take and a valid instance of itself, and the starting point for every page about Hypermedia Schemas.
---
A **schema** is a description of what some data must look like. It says which fields the data has and what kind of value each field holds. Software uses a schema to check data and to draw forms for it. A schema is data too, so one schema can describe other schemas. <!-- id:OzcV9e2b -->

Here is a small schema. It says: the data is a map with one required field, `surname`, and that field is a string.

```json
{
  "type": "hm://hyper.media/struct",
  "properties": {
    "surname": {"value": {"type": "hm://hyper.media/string"}, "required": true}
  }
}
```

The value `{"surname": "Smith"}` matches this schema. The values `{}` and `{"surname": 7}` do not.

The one schema that describes all schemas is the **meta-schema**. Its name is `schema`, and this page is its home. The meta-schema lists every shape a schema can take: nine shapes that are maps, and four kinds of plain value. Each shape is called a [variant](./schema/variant.md). A plain value such as `"draft"`, `1`, `true` or `null` is a [literal](./schema/literal-schema.md): a schema that accepts only that one value. The meta-schema is a [discriminated union](./schema/discriminated-union.md), which means it picks one variant for each schema it checks. It also [describes itself](./schema/self-description.md): it is a valid schema by its own rules. Software knows the meta-schema without looking it up. <!-- id:bXl0LFcD -->

The formal schema of the meta-schema is attached to this page. The `schemaDefinition` key in this page's [metadata](./metadata.md) points at it, so the [Seed app](./software/desktop.md) can show it and create values of this type. This page is also the starting point for all the pages about Hypermedia Schemas. They are listed below. <!-- id:y93xpe-t -->

# Hypermedia Schemas in brief <!-- id:sPmTq8Rq -->

**Hypermedia Schemas are a type system for content-addressed data.** Content-addressed data is data that is named by the hash of its bytes. The schemas type the [IPLD](./schema/ipld.md) and [DAG-CBOR](./schema/dag-cbor.md) values that Hypermedia [blocks](./protocol/blocks.md) and [blobs](./protocol/blobs.md) are built from. A schema is itself a DAG-CBOR object on IPFS. So a schema [references](./schema/references.md) another schema the same way data references data. <!-- id:YSBcigax -->

- Every value is one of **nine [kinds](./schema/kind.md)**: `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. <!-- id:Zyqnpby8 -->
- A **schema** names a kind or another schema with `type`. The other keys narrow what it names: `properties` for the fields of a [struct](./struct.md), `items` for a list, `values` for a map, `anyOf` for a union, and value constraints such as `minLength` and `pattern`. A fixed set of choices is a [union](./schema/anyof.md) of literals. The words are all in [the schema language](./schema/schema-language.md). <!-- id:Jb3Yvg3p -->
- Schemas reference each other by **[hm:// URL](./protocol/urls.md)**, which is a name. Two names can point at each other in a circle. Two [content hashes cannot](./schema/fixpoint-problem.md). So names let types refer to themselves and to each other. <!-- id:KVkmtla5 -->
- You can publish a schema as a normal Hypermedia [document](./protocol/documents.md). The document's [metadata](./metadata.md) has a `schemaDefinition` key that points at the schema [blob](./protocol/blobs.md) as `ipfs://<cid>`. Other schemas and documents then reference the document by name, and the [CID](./cid.md) pins the exact bytes. The type system lives on the same network it types. <!-- id:lp-qJpvG -->
- The editors only **warn** about data that breaks its schema, and never block a save. The validator, the checks of the [CLI](./build/cli.md) and the blob writes of an [agent](./agent.md) are **strict**: they refuse it. <!-- id:4a6RPK0p -->

# Where to read next <!-- id:XQr4-lP- -->

Read the concepts in this order: <!-- id:MLxtm7My -->
  1. [The data model](./schema/data-model.md): the nine kinds of value. Read it first. <!-- id:_5H16K85 -->
  2. [The schema language](./schema/schema-language.md): the full reference for every key a schema can use, and how the language describes itself. <!-- id:dS1O-Jw6 -->
  3. [References and naming](./schema/references.md): the ways one schema points at another, `hm://` names, and why names can form a circle where hashes cannot. <!-- id:W-7l34pY -->
  4. [Encoding](./schema/encoding.md): DAG-CBOR, the dag-json form that people read, canonical encoding and a schema's CID. <!-- id:zc8wCFCX -->

Then go to the page for what you want to do:
  - [Typed documents](./schema/typed-documents.md): how a [document](./protocol/documents.md) says what it is with `attributesSchema`, `childAttributesSchema` and `schemaDefinition`, and what the editor does with them. <!-- id:ejnPERZF -->
  - [Typing a blob](./schema/typing-a-blob.md): how a raw DAG-CBOR object links to its schema, with a worked example.
  - [Schemas on the Hypermedia Network](./schema/blobs.md): how schemas type the signed blobs ([Change](./change.md), [Ref](./ref.md), [Profile](./profile.md) and the rest) and the block model. It also shows how to define a signed blob type or a block type of your own. <!-- id:SZlHsPnT -->
  - [The catalogue of types](./schema/types.md): every type in the library with one line each. Use it to find a type's page.
  - [Examples](./example.md): every example schema, grouped by the feature it shows. <!-- id:nslzTd6Z -->
  - [Schema workflows](./schema/workflows.md) and [typed blob workflows](./schema/blob-workflows.md): numbered steps for each task in the Seed app, with the CLI and through an agent. They also say how to turn the schema menus on. <!-- id:xzhJgjsb -->
  - [The World Builder](./schema/world-builder.md): a worked demo that builds a set of linked types, with date pickers, title pills and linked objects on every page. <!-- id:JKC7fUPx -->
  - [Why Schemas](./schema/why.md): the problem they solve, the reasons behind the language, and what it does not try to do. <!-- id:ASDj0A2q -->
  - [The schema library pipeline](./schema/library-pipeline.md): for contributors. It shows how the Seed repository checks, pins, publishes and bundles the library.

# Words used in these pages <!-- id:g0hNqX_Z -->

Each word below links the page that defines it. <!-- id:lZdOYrQc -->

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
- [`hm://` URL](./protocol/urls.md) <!-- id:pvOG8a9_ -->
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
