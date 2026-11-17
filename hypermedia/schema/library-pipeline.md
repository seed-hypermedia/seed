---
name: The Schema Library Pipeline
summary: How the Seed repository turns the schema files of the library into pinned CIDs, published blobs and pages, a registry bundled into the apps and generated TypeScript types, and the checks that keep them in step.
---
The library of [Hypermedia Schemas](../schema.md) is a folder in the Seed repository. This page is for people who change that folder. It follows a schema file through the scripts in `scripts/hypermedia/`: the reference validator, the lockfile, the push to the network, the registry bundled into the apps, and the generated TypeScript types. [The catalogue of types](./types.md) lists what the library holds, and [publishing a folder](../build/publish-a-folder.md) describes the sync that publishes the whole site.

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

# The folder <!-- id:JEnxb06S -->

The library is a folder of pairs: `<name>.schema.json` holds the schema in [dag-json](./dag-json.md), and `<name>.md` explains it. A schema's name is its path inside `hypermedia/` without `.schema.json`, such as `string`, `block/image` or `example/person`. Two families live side by side, told apart by path prefix:

<!-- id:QKRHc2jO -->
| prefix <!-- col:PpnISgiK --> | family <!-- col:u7IW2VGz --> | examples <!-- col:UvNmWoqE --> <!-- id:rMJt-Vv8 --> |
| --- | --- | --- |
| root and `schema/` | the Hypermedia Network's real blobs, one canonical primitive per kind and the meta-schema at the root, the block model in `block/`; under `schema/`, the type language's variants | `schema`, `schema/anyof`, `string`, `change`, `block/table` <!-- id:bPX-_f4P --> |
| `example/` | teaching schemas covering every feature, plus live instances | `example/person`, `example/folder`, `example/bob` <!-- id:uU6GnKnu --> |

Inside a schema file, every reference is an `hm://` URL with the authority `hyper.media`, and the URL path is the file's path: `hm://hyper.media/string`, `hm://hyper.media/metadata`, `hm://hyper.media/example/person`. [References and naming](./references.md) explains what resolves that name.

A page with a schema file beside it cannot be renamed or moved without renaming the type, because the path is the type's name.

# The reference validator

`validate.mjs` is the reference validator. It has no dependencies. It proves the [meta-schema](../schema.md) describes itself, validates every schema in the library against it, checks accepting and rejecting data cases for the examples and the blob schemas, and confirms the union rejects malformed schemas.

```sh <!-- id:PxteeEDG -->
node scripts/hypermedia/validate.mjs
#   ok   schema.schema.json describes itself
#   ...
#   ok   schema/map-schema.schema.json
#   ...
#   ok   scalar carrying `items` (rejected)
```

If you extend the vocabulary, run it again. If the union can no longer describe its own new shape, the loop is broken and the check fails. <!-- id:vGjbVugA -->

To check your own data file against a library schema, name the schema and the file. <!-- id:JNwDHyeL -->

```sh <!-- id:wqTx5NHe -->
node scripts/hypermedia/validate.mjs example/article my-article.json
```

There is one validation engine. The app, the [Seed CLI](../build/cli.md), the [SDK](../build/sdk.md) and [Seed Agents](../agent.md) run a port of the reference validator from `@seed-hypermedia/client`, covered by the same cases, so no surface disagrees with it.

# The lockfile <!-- id:tf74B4h5 -->

**`publish.mjs`** encodes each schema to [canonical DAG-CBOR](./canonical-encoding.md), hashes it, and writes `schemas.lock.json`. The lockfile maps every `hm://` URL to its content CID. It is the contract between the repository and the network: a schema cannot change without the lockfile changing too. <!-- id:9Dnutfyd -->

`publish.mjs` publishes nothing and does not rewrite references into CIDs, so recursive and mutually recursive schemas keep working. `node scripts/hypermedia/publish.mjs --check` runs in CI. It fails if the lockfile is stale, and a CID that changes in a diff means the schema changed.

# The push

**`pnpm hypermedia:push`** signs with the `main` key, or with the key in the environment in CI, and publishes into that key's space in two steps. First it recomputes every schema CID, stops if any differs from the lockfile, and uploads the schema blobs. Then it imports the whole `hypermedia/` folder as documents, and each page publishes at its path. `index.md` becomes the home document. A **type** page carries `schemaDefinition = ipfs://<cid>`, which says this document defines a type. An **instance** page, such as `example/bob`, holds its data in frontmatter and carries `attributesSchema = hm://<type>`, which says this document conforms to a type. The files write these URLs as `hm://hyper.media/…`. The push swaps `hyper.media` for the signing key in page links and frontmatter, and `pull` swaps it back, so git never holds a key. Schema blobs are uploaded unchanged, so a schema has the same CID wherever the library is published. See [publishing a folder](../build/publish-a-folder.md). <!-- id:nbEaMwcF -->

So the type system lives on the network it types: browsing the account is browsing the library. <!-- id:Tq9j2_Wz -->

# Generated code <!-- id:jpRr0H4N -->

`typegen.mjs` walks the library and emits one TypeScript type per schema into `schema-types.generated.ts` in `@seed-hypermedia/client` (`HMDocument`, `HMMetadata`, `HMChange<B>`, …). A map becomes an object type, a literal becomes a literal type, `anyOf` becomes a union, extension becomes an intersection, and an open map becomes an index signature. `params`, `var` and `args` become real generics, so `Change<Block>` in the schema is `Change<Block>` in TypeScript. A self-referential schema, like a recursive JSON value, comes out as a legal recursive type. A `--check` mode fails when the generated file is stale. The schemas are the source of truth for the app's data types, and nobody writes those type declarations by hand. <!-- id:e53sOros -->

`gen-registry.mjs` bundles the library for the apps: every schema, its CID, and the name and summary of the page that defines it. The apps resolve `hm://hyper.media/…` references from this bundle with no network.

# The checks <!-- id:4g92-jwm -->

`pnpm hypermedia:check` (`check.mjs`) runs every offline check in one command, and CI runs it before a push. The system holds together because of a few properties those checks protect:
  - **Same bytes, same CID.** Canonical DAG-CBOR encoding means any implementation that hashes a schema gets the lockfile's CID. The sync refuses to publish otherwise. <!-- id:17JdAoWE -->
  - **The meta-schema validates itself** and rejects malformed schemas. Every validator run checks this. <!-- id:v4RipaVL -->
  - **One engine.** The app's validation is a port of the reference validator, covered by the same cases. <!-- id:tEOXXBEn -->
  - **Every reference is a document.** There are no placeholder names. Each `hm://` URL in a schema resolves to a published page. <!-- id:K7oi_vA8 -->
  - **Generated code matches the library.** `typegen --check` and the bundled-registry generator fail the build when out of date. <!-- id:qvFbt6RU -->
  - **One spelling.** A schema node names what it is with `type`. The check rejects the retired keywords `ref` and `$type` in library files. A schema published elsewhere that spells a reference `ref` still resolves.

# See also <!-- id:52kolQhw -->

- [Publishing a folder](../build/publish-a-folder.md): how a folder of pages becomes a site, and the sync commands. <!-- id:ueJwXaZU -->
- [Editing these docs](../contribute/editing-these-docs.md): the rules and checks for the `hypermedia/` folder.
- [Contributing](../contribute/contributing.md): the repository layout and its checks.
- [The catalogue of types](./types.md): every type the library holds.
- [The schema language](./schema-language.md): every schema shape and constraint. <!-- id:xBBlJDIT -->
- [References and naming](./references.md): include, link and `hm://` names. <!-- id:Vxd2KOx9 -->
- [Encoding](./encoding.md): DAG-CBOR, dag-json and canonical encoding. <!-- id:VtAEOLmv -->
