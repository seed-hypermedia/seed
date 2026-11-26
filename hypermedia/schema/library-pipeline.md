---
name: The Schema Library Pipeline
summary: The Seed repository turns the schema files of the library into fixed CIDs, published blobs and pages, a registry bundled into the apps and generated TypeScript types, and checks keep them in step.
---
The library of [Hypermedia Schemas](../schema.md) is a folder of files in the Seed repository. Scripts turn each schema file into a published schema, a page, and TypeScript types. This page is for people who change that folder.

The page follows one schema file through the scripts in `scripts/hypermedia/`. The steps are the reference validator, the lockfile, the push to the network, the registry bundled into the apps, and the generated TypeScript types. [The catalogue of types](./types.md) lists what the library holds. [Publishing a folder](../build/publish-a-folder.md) describes the command that publishes the whole [site](../protocol/sites.md).

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
   (Schema view, editors, inspector)  (attributesSchema / childAttributesSchema)  (TS types)
```

# The folder <!-- id:JEnxb06S -->

The library is a folder of pairs. `<name>.schema.json` holds the schema in [dag-json](./dag-json.md), and `<name>.md` explains it. The name of a schema is its path inside `hypermedia/` without `.schema.json`, such as `string`, `block/image` or `example/person`. The folder holds two families. The path tells you which one a schema belongs to:

<!-- id:QKRHc2jO -->
| prefix <!-- col:PpnISgiK --> | family <!-- col:u7IW2VGz --> | examples <!-- col:UvNmWoqE --> <!-- id:rMJt-Vv8 --> |
| --- | --- | --- |
| everything outside `example/` | the types the network really uses. At the root: one [primitive](./primitive.md) per [kind](./kind.md), the meta-schema and the [blob](../protocol/blobs.md) types. In `block/`: the [block](../protocol/blocks.md) model. In `schema/`: the [variants](./variant.md) of the schema language | `schema`, `schema/anyof`, `string`, `change`, `block/table` <!-- id:bPX-_f4P --> |
| `example/` | schemas for learning, which cover every feature, plus live instances | `example/person`, `example/folder`, `example/bob` <!-- id:uU6GnKnu --> |

Inside a schema file, every reference is an [`hm://` URL](../protocol/urls.md) with the [authority](../authority.md) `hyper.media`. The path of the URL is the path of the file: `hm://hyper.media/string`, `hm://hyper.media/metadata`, `hm://hyper.media/example/person`. [References and naming](./references.md) explains what resolves that name.

The path is the name of the type. So if you rename or move a page that has a schema file beside it, you rename the type.

# The reference validator

`validate.mjs` is the reference validator. It has no dependencies. It does four things:

- It proves that the [meta-schema](../schema.md) describes itself.
- It checks every schema in the library against the meta-schema.
- It runs data cases for the examples and the blob schemas: some must pass and some must fail.
- It confirms that the meta-schema rejects broken schemas.

```sh <!-- id:PxteeEDG -->
node scripts/hypermedia/validate.mjs
#   ok   schema.schema.json describes itself
#   ...
#   ok   schema/map-schema.schema.json
#   ...
#   ok   scalar carrying `items` (rejected)
```

If you add a key to the schema language, run it again. The meta-schema must still describe its own new shape. If it cannot, the check fails. <!-- id:vGjbVugA -->

To check your own data file against a library schema, give the schema name and the file. <!-- id:JNwDHyeL -->

```sh <!-- id:wqTx5NHe -->
node scripts/hypermedia/validate.mjs example/article my-article.json
```

There is one validation engine. The app, the [Seed CLI](../build/cli.md), the [SDK](../build/sdk.md) and [Seed Agents](../agent.md) all run the copy of the reference validator in `@seed-hypermedia/client`. The same test cases cover it, so every program gives the same answer.

# The lockfile <!-- id:tf74B4h5 -->

**`publish.mjs`** encodes each schema to [canonical](./canonical-encoding.md) [DAG-CBOR](./dag-cbor.md), hashes it, and writes `schemas.lock.json`. The lockfile maps every `hm://` URL to the [CID](../cid.md) of its content. It ties the repository to the network: a schema cannot change unless the lockfile changes too. <!-- id:9Dnutfyd -->

Despite its name, `publish.mjs` publishes nothing. It also does not rewrite references into CIDs, so schemas that refer to themselves or to each other keep working. `node scripts/hypermedia/publish.mjs --check` runs in CI. It fails if the lockfile is out of date. A CID that changes in a diff means the schema changed.

# The push

**`pnpm hypermedia:push`** signs with the `main` key, or in CI with the key in the environment. It publishes into the [space](../protocol/spaces.md) of that key, in two steps:

1. It computes every schema CID again, stops if any differs from the lockfile, and uploads the schema blobs.
2. It imports the whole `hypermedia/` folder as [documents](../protocol/documents.md). Each page publishes at its path, and `index.md` becomes the [home document](../protocol/spaces.md).

Two kinds of page carry a schema field:

- A **type** page carries `schemaDefinition = ipfs://<cid>`. This says the document defines a type.
- An **instance** page, such as `example/bob`, holds its data in frontmatter and carries `attributesSchema = hm://<type>`. This says the document follows a type.

The files write these URLs as `hm://hyper.media/…`. The push swaps `hyper.media` for the signing key in page links and frontmatter, and `pull` swaps it back, so git never holds a key. The push uploads schema blobs unchanged, so a schema has the same CID wherever the library is published. See [publishing a folder](../build/publish-a-folder.md). <!-- id:nbEaMwcF -->

So the types live on the same network as the data they describe. When you browse the [account](../protocol/identity.md), you browse the library. <!-- id:Tq9j2_Wz -->

# Generated code <!-- id:jpRr0H4N -->

`typegen.mjs` reads the library and writes one TypeScript type per schema into `schema-types.generated.ts` in `@seed-hypermedia/client` (`HMDocument`, `HMMetadata`, `HMChange<Block>`, …). Each schema shape has a TypeScript shape:

- A [struct](../struct.md) becomes an object type.
- A literal becomes a literal type.
- `anyOf` becomes a union.
- An extension becomes an [intersection](./allof.md).
- An open map becomes an index signature.
- `params`, `var` and `args` become real generics, so `Change<Block>` in the schema is `HMChange<Block>` in TypeScript.
- A schema that refers to itself becomes a recursive type.

`typegen.mjs --check` fails when the generated file is out of date. The schemas are the one source for the app's data types. Nobody writes those type declarations by hand. <!-- id:e53sOros -->

`gen-registry.mjs` bundles the library for the apps: every schema, its CID, and the name and summary of the page that defines it. The apps resolve `hm://hyper.media/…` references from this bundle and need no network for it.

# The checks <!-- id:4g92-jwm -->

`pnpm hypermedia:check` (`check.mjs`) runs every offline check in one command. CI runs it before a push. The checks protect these rules:
  - **Same bytes, same CID.** The encoding is canonical DAG-CBOR, so any program that hashes a schema gets the CID in the lockfile. The push refuses to publish if it does not. <!-- id:17JdAoWE -->
  - **The meta-schema checks itself** and rejects broken schemas. Every run of the validator tests this. <!-- id:v4RipaVL -->
  - **One engine.** The app's validator is a copy of the reference validator, and the same cases cover it. <!-- id:tEOXXBEn -->
  - **Every reference is a document.** There are no placeholder names. Each `hm://` URL in a schema resolves to a published page. <!-- id:K7oi_vA8 -->
  - **Generated code matches the library.** The check runs both generators and fails if either file changed. Commit the regenerated files. <!-- id:qvFbt6RU -->
  - **One spelling.** A schema node names what it is with `type`. The check rejects the keywords `ref` and `$type` in library files. A schema published elsewhere that writes a reference as `ref` still resolves.

# See also <!-- id:52kolQhw -->

- [Publishing a folder](../build/publish-a-folder.md): how a folder of pages becomes a site, and the commands that do it. <!-- id:ueJwXaZU -->
- [Editing these docs](../contribute/editing-these-docs.md): the rules and checks for the `hypermedia/` folder.
- [Contributing](../contribute/contributing.md): the repository layout and its checks.
- [The catalogue of types](./types.md): every type the library holds.
- [The schema language](./schema-language.md): every schema shape and constraint. <!-- id:xBBlJDIT -->
- [References and naming](./references.md): include, link and `hm://` names. <!-- id:Vxd2KOx9 -->
- [Encoding](./encoding.md): DAG-CBOR, dag-json and canonical encoding. <!-- id:VtAEOLmv -->
