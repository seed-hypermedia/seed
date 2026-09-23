---
name: How Schemas Work
summary: The system end to end, from a schema file in the repository to a signed blob on the network, a browsable document, a resolved reference in the app, a generated TypeScript type and a typed API call.
---
# The tour in one paragraph <!-- id:7s8eFKqO -->

A [schema](../schema.md) is a small JSON file. A publisher hashes it to its [DAG-CBOR](./dag-cbor.md) [CID](../protocol/blobs.md) and records the CID in a lockfile. A sync uploads the [blob](../protocol/blobs.md) and publishes a companion [document](../protocol/documents.md) at an [`hm://` URL](../protocol/urls.md) in the space of the [account](../protocol/identity.md) that signs the push. That document's [metadata](../metadata.md) points at the blob. Apps bundle the library, resolve any other reference over the network, and run one validation engine to drive explorers, editors, forms and warnings. The reference validator uses the same engine. A generator turns every schema into a TypeScript type. The sections below take each layer in turn. <!-- id:UiSIhbqU -->

``` <!-- id:UwMwRuEn -->
  hypermedia/<name>.schema.json ──publish.mjs──▶ schemas.lock.json (name → CID)
        │  + <name>.md                      │
        │                                   ▼
        └──────hypermedia:push──▶ DAG-CBOR blob (ipfs://<cid>)
                              + document hm://<key>/<name>
                                  metadata.schemaDefinition = ipfs://<cid>
                                            │
              ┌─────────────────────────────┼──────────────────────────┐
              ▼                             ▼                          ▼
   bundled registry in the app     resolved over the network     typegen.mjs
   (tour, editors, inspector)  (attributesSchema / childAttributesSchema)  (TS types)
```

# Layer 1: values and the codec <!-- id:yNp--FS1 -->

Everything a schema types is an [IPLD](./ipld.md) value. Each value is one of nine [kinds](./kind.md): `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. The canonical form is [DAG-CBOR](./dag-cbor.md), a deterministic binary encoding with a native link type for [CIDs](../cid.md). The human form is [dag-json](./dag-json.md), a lossless JSON projection. It spells a link as `{"/": "bafy…"}` and bytes as `{"/": {"bytes": "…"}}`. The repository holds dag-json, and the network holds DAG-CBOR. Both are projections of one graph, and converting between them is mechanical. See [the data model](./data-model.md) and [encoding](./encoding.md). <!-- id:zh579VQH -->

# Layer 2: schemas and the meta-schema <!-- id:oOZsaLa6 -->

A schema is a `map` value that constrains other values. It takes one of ten shapes: <!-- id:wjogEwsM -->
  - a [`struct` schema](./struct-schema.md) with named fields, <!-- id:yetSbHOT -->
  - a [`map` schema](./map-schema.md), an open map typed by `values`, <!-- id:nf_BZvrL -->
  - a [`list` schema](./list-schema.md), <!-- id:cPxjp5jT -->
  - a [`scalar` schema](./scalar-schema.md) with value constraints, <!-- id:HPbQwpOg -->
  - a [`link` schema](./link-schema.md), a typed CID, <!-- id:ptezErPy -->
  - an [`include`](./include-schema.md), a `type` that names another schema, <!-- id:sH-uapmQ -->
  - a union with [`anyOf`](./anyof.md), <!-- id:3Dpdfoiy -->
  - an intersection with [`allOf`](./allof.md), its struct arms merged,
  - a [`var`](./var-schema.md), a type variable for [generics](./generic.md), <!-- id:N-VbcTAm -->
  - a [`literal`](./literal-schema.md) written `{value, description}`. <!-- id:N7cdcnDo -->

A bare string, integer, boolean or null is also a literal and accepts exactly that value. The [meta-schema](../schema.md) is the schema of schemas. It is the [discriminated union](./discriminated-union.md) of those shapes, and it validates as an instance of itself. The reference validator checks this [self-description](./self-description.md) on every run. See [the schema language](./schema-language.md). <!-- id:D-0xApZo -->

# Layer 3: the library <!-- id:JEnxb06S -->

The library is a folder of pairs: `<name>.schema.json` holds the schema in dag-json, and `<name>.md` explains it. Three families live side by side, told apart by path prefix: <!-- id:aoVPGRff -->

<!-- id:QKRHc2jO -->
| prefix <!-- col:PpnISgiK --> | family <!-- col:u7IW2VGz --> | examples <!-- col:UvNmWoqE --> <!-- id:rMJt-Vv8 --> |
| --- | --- | --- |
| root and `schema/` | the Hypermedia Network's real blobs, one canonical primitive per kind and the meta-schema at the root, the block model in `block/`; under `schema/`, the type language's variants | `schema`, `schema/anyof`, `string`, `change`, `block/table` <!-- id:bPX-_f4P --> |
| `example/` | teaching schemas covering every feature, plus live instances | `example/person`, `example/folder`, `example/bob` <!-- id:uU6GnKnu --> |

Inside a schema, every reference is an `hm://` URL with the authority `hyper.media`, and the URL path is the file's path: `hm://hyper.media/string`, `hm://hyper.media/metadata`, `hm://hyper.media/example/person`. `hyper.media` is a name the SDK and the sync understand. The network does not resolve domains in `hm://` URLs yet (that is planned), so the app resolves these references from its bundled library. Each name also has a published page at the same path in the docs space, and that page's URL carries the space's key. See [references and naming](./references.md). <!-- id:HVN-l5c6 -->

# Layer 4: publishing <!-- id:tf74B4h5 -->

Two scripts publish the folder to the network. <!-- id:A7RyUZrS -->

**`publish.mjs`** encodes each schema to [canonical DAG-CBOR](./canonical-encoding.md), hashes it, and writes `schemas.lock.json`. The lockfile maps every `hm://` URL to its content CID. It is the contract between the repository and the network: a schema cannot change without the lockfile changing too. <!-- id:9Dnutfyd -->

**`hypermedia:push`** signs with the `main` key, or with the key in the environment in CI, and publishes into that key's space in two steps. First it recomputes every schema CID, stops if any differs from the lockfile, and uploads the schema blobs. Then it imports the whole `hypermedia/` folder as documents, and each page publishes at its path. `index.md` becomes the home document. A **type** page carries `schemaDefinition = ipfs://<cid>`, which says this document defines a type. An **instance** page, such as `example/bob`, holds its data in frontmatter and carries `attributesSchema = hm://<type>`, which says this document conforms to a type. The files write these URLs as `hm://hyper.media/…`. The push swaps `hyper.media` for the signing key in page links and frontmatter, and `pull` swaps it back, so git never holds a key. Schema blobs are uploaded unchanged. The narrative pages you are reading publish the same way. See [publishing a folder](../build/publish-a-folder.md). <!-- id:nbEaMwcF -->

So the type system lives on the network it types: browsing the account is browsing the library. <!-- id:Tq9j2_Wz -->

# Layer 5: resolution <!-- id:Rb6zmKSF -->

A schema reference comes in three forms, and the app resolves each one differently: <!-- id:ZVviNKyM -->

<!-- id:uSHoX7eZ -->
| reference <!-- col:JXT6M672 --> | example <!-- col:lj87cEho --> | how it resolves <!-- col:FkwrUKdr --> <!-- id:DxBoBqwn --> |
| --- | --- | --- |
| library URL | `hm://hyper.media/map` | locally, from the registry compiled into the app, with no network <!-- id:_MyC7yOr --> |
| IPFS CID | `ipfs://bafy…` | fetch the blob directly (bundled if known, otherwise from the daemon) <!-- id:0XLNPaVl --> |
| any Hypermedia document URL | `hm://acme/person` | fetch the document, read its `metadata.schemaDefinition`, then fetch that blob <!-- id:a2Tm8pMr --> |

The third form lets anyone add types: a schema published under any account resolves the same way as one from the library. Network resolution is asynchronous, so the app exposes it through two hooks. One resolves a single reference. The other computes a document's _effective_ attributes schema: its own `attributesSchema`, or else its parent's `childAttributesSchema`. See [typed documents](./typed-documents.md). <!-- id:abCKIpn0 -->

# Layer 6: the engine and the app <!-- id:_2KVPjV5 -->

There is one validation engine. The reference validator has no dependencies. It proves the meta-schema describes itself, validates every schema in the library against it, checks positive and negative data cases for the examples, and confirms the union rejects malformed schemas. The app runs a line-for-line port of the same engine, so the app cannot disagree with the reference validator. The app builds these on top of it: <!-- id:7XvEeHE4 -->
  - The **schema tour and explorer** render every schema as a page. The page shows fields, variants, inherited and added properties, generic parameters, URL and CID, dependencies and dependents, and a live editor. <!-- id:JFNU8FGg -->
  - The **schema editor** is a form driven by the meta-schema, so it can only produce valid schemas. <!-- id:QdeIRLDj -->
  - The **value editor** is a form that builds data matching a schema. It has dropdowns for unions of literals, pickers for union variants, the right controls for `link` and `bytes`, title pills for document references and file pickers for IPFS references. <!-- id:SKTxHaI7 -->
  - The **document integration** shows required attributes as fixed rows, validation problems in red without blocking, and header actions on a schema-definition document. <!-- id:tvgeEE11 -->
  - The **inspector** recognizes the signed blob types, detects when a blob _is_ a schema, and validates a blob against its attached schema. <!-- id:Ig_ARwrI -->

These tools sit behind Developer Mode in the Seed app. Developer Mode is off by default in the [desktop app](../apps/desktop.md) and on by default in the [web app](../apps/web.md). Any schema blob, bundled or published, has a full page at `/hm/schema/<cid>`. On that page every reference is a link: a library type, an `hm://` type document or an `ipfs://` schema. You browse a schema graph by clicking. A schema that [extends](./extension.md) [Signed blob](../blob.md) gets a signing form instead of a plain editor. At publish time the form fills in the [envelope](./envelope.md) and signs it with the selected account. <!-- id:3fjjdA74 -->

# Layer 7: generated code <!-- id:jpRr0H4N -->

`typegen.mjs` walks the library and emits one TypeScript type per schema. A map becomes an object type, a literal becomes a literal type, `anyOf` becomes a union, extension becomes an intersection, and an open map becomes an index signature. `params`, `var` and `args` become real generics, so `Change<Block>` in the schema is `Change<Block>` in TypeScript. A self-referential schema, like a recursive JSON value, comes out as a legal recursive type. A `--check` mode fails when the generated file is stale. The schemas are the source of truth for the app's data types, and nobody writes those type declarations by hand. <!-- id:e53sOros -->

# The invariants <!-- id:4g92-jwm -->

The system holds together because of a few properties that tooling checks: <!-- id:TlR4ILmy -->
  - **Same bytes, same CID.** Canonical DAG-CBOR encoding means any implementation that hashes a schema gets the lockfile's CID. The sync refuses to publish otherwise. <!-- id:17JdAoWE -->
  - **The meta-schema validates itself** and rejects malformed schemas. Every validator run checks this. <!-- id:v4RipaVL -->
  - **One engine.** The app's validation is a port of the reference validator, covered by the same cases. <!-- id:tEOXXBEn -->
  - **Every reference is a document.** There are no placeholder names. Each `hm://` URL in a schema resolves to a published page. <!-- id:K7oi_vA8 -->
  - **Generated code matches the library.** `typegen --check` and the bundled-registry generator fail the build when out of date. <!-- id:qvFbt6RU -->
  - **Warnings never block writes.** A document with out-of-spec data still saves. The app shows the mismatch and does not enforce it. <!-- id:gl1Qu8GD -->

# See also <!-- id:52kolQhw -->

- [Hypermedia Schemas in one page](./quick-reference.md): the model, the library and the tools in brief. <!-- id:Wj-sDIOm -->
- [The schema language](./schema-language.md): every schema shape and constraint. <!-- id:xBBlJDIT -->
- [Typed documents](./typed-documents.md): the three binding keys and what the editor does with them. <!-- id:sMccYqLb -->
- [References and naming](./references.md): include, link and `hm://` names. <!-- id:Vxd2KOx9 -->
- [Encoding](./encoding.md): DAG-CBOR, dag-json and canonical encoding. <!-- id:VtAEOLmv -->
- [Publishing a folder](../build/publish-a-folder.md): how a folder of pages becomes a site. <!-- id:ueJwXaZU -->
- [Blobs](../protocol/blobs.md): signed blobs and content addressing on the network. <!-- id:KvT5OKM7 -->
