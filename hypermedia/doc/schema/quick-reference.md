---
name: Hypermedia Schemas in One Page
summary: The condensed reference — the model, the library by link, how a document is typed with attributesSchema / childAttributesSchema / schemaDefinition, and the exact commands, SDK calls, and agent verbs that read, write, and check them.
---
Everything on this page is a link into the reference; read it top to bottom once, then use it as an index. The long versions: [why](./why.md), [how it works](./how-it-works.md), [the schema language](../../schema/schema-language.md), [typed documents](../../schema/typed-documents.md), [user stories](./user-stories.md). <!-- id:h5cwDrts -->

# The model in ten lines <!-- id:WLRqc2K4 -->

- Every value is one of **nine [kinds](../../schema/kind.md)**: [null](../../null.md), [boolean](../../boolean.md), [integer](../../integer.md), [float](../../float.md), [string](../../string.md), [bytes](../../bytes.md), [list](../../list.md), [map](../../map.md), [link](../../link.md). [struct](../../struct.md) is a map with named fields. The bytes are [DAG-CBOR](../../schema/dag-cbor.md); the readable form is [dag-json](../../schema/dag-json.md). <!-- id:H5eL6ixB -->
- A **schema** is a map that constrains a value: `type`, `properties` (one [property](../../schema/property.md) per field: `{value, required?, description?}`), `items`, `values`, `ref`, `anyOf`, `target`, generics, and leaf constraints — or a bare literal (`"draft"`, `1`) that accepts exactly that value. See [the schema language](../../schema/schema-language.md). <!-- id:Wyj6bKBt -->
- The **[meta-schema](../../schema.md)** describes what a schema is: a union of [struct-schema](../../schema/struct-schema.md), [map-schema](../../schema/map-schema.md), [list-schema](../../schema/list-schema.md), [scalar-schema](../../schema/scalar-schema.md), [link-schema](../../schema/link-schema.md), [include-schema](../../schema/include-schema.md), [anyof](../../schema/anyof.md), [var-schema](../../schema/var-schema.md), [literal-schema](../../schema/literal-schema.md). It validates itself. <!-- id:kh_e5uKR -->
- A schema is itself a DAG-CBOR blob with a CID; schemas reference each other by **`hm://` name** ([references](../../schema/references.md)), which is what lets types recurse and form cycles ([the fixpoint problem](../../schema/fixpoint-problem.md)). <!-- id:zm8ENE2w -->
- `{ref: X}` alone **includes** X; `{ref: X, properties: …}` **[extends](../../schema/extension.md)** it — the parent's fields plus new ones, closedness kept. <!-- id:3s1dFPYn -->
- Validation is **advisory** in the editors (warn, never block) and **strict** in the reference validator, the CLI's checks, and the agent's refusals for blobs. <!-- id:qnkL2XO2 -->

# The library, by link <!-- id:y2Zw6upY -->

- **Refined primitives** — [date](../../date.md), [date-time](../../date-time.md), [timestamp](../../timestamp.md), [url](../../url.md), [hm-url](../../hm-url.md), [ipfs-url](../../ipfs-url.md), [cid](../../cid.md), [principal](../../principal.md), [signature](../../signature.md), [any](../../any.md), [value](../../value.md), [key-value](../../key-value.md). <!-- id:pZyP91zU -->
- **Network blobs** ([the blobs chapter](../../schema/blobs.md)) — every signed object extends the [blob](../../blob.md) envelope: [change](../../change.md) (with [change/body](../../change/body.md) and the [ops](../../change/op.md)), [ref](../../ref.md), [comment](../../comment.md), [capability](../../capability.md), [contact](../../contact.md), [profile](../../profile.md); the union is [blob/any](../../blob/any.md). <!-- id:glkoL1dw -->
- **The document model** — [document](../../document.md) is `{metadata, content}`; [metadata](../../metadata.md) carries the three binding keys below; `content` is a tree of [block/node](../../block/node.md), each a [block](../../block.md) such as [paragraph](../../block/paragraph.md), [heading](../../block/heading.md), [image](../../block/image.md), [file](../../block/file.md), [embed](../../block/embed.md), [query](../../block/query.md) (a [query](../../query.md)), with [annotations](../../block/annotation.md). <!-- id:LmMZDdwv -->
- **The typed API** — every read method of the Seed API as a schema under [rpc](../../rpc.md): [resource](../../rpc/resource.md), [query](../../rpc/query.md), [search](../../rpc/search.md), [list-changes](../../rpc/list-changes.md), [list-comments](../../rpc/list-comments.md), [get-cid](../../rpc/get-cid.md), and the rest. <!-- id:hJODSRen -->
- **Examples** ([the index](../../example.md)) — structs: [person](../../example/person.md), [employee](../../example/employee.md) (extends person), [address](../../example/address.md), [stats](../../example/stats.md), [geo](../../example/geo.md), [constrained](../../example/constrained.md); maps and lists: [counts](../../example/counts.md), [tags](../../example/tags.md), [matrix](../../example/matrix.md), [tree](../../example/tree.md) (recursive), [json](../../example/json.md) (generic); a custom block and a custom Change: [poll-block](../../example/poll-block.md), [app-block](../../example/app-block.md), [myapp-change](../../example/myapp-change.md); **attributes schemas** for typed documents: [person-doc](../../example/person-doc.md), [world-doc](../../example/world-doc.md), [character-doc](../../example/character-doc.md), [place-doc](../../example/place-doc.md), [faction-doc](../../example/faction-doc.md), [event-doc](../../example/event-doc.md); **instances** (data, not types): [alice](../../example/alice.md), [bob](../../example/bob.md), [carol](../../example/carol.md), [dave](../../example/dave.md), [root](../../example/root.md). <!-- id:1PrUauve -->

# Typed documents: three keys <!-- id:Odvquz70 -->

<!-- id:M2OTNpuI -->
| key <!-- col:JmRHPKan --> | on which document <!-- col:9aQ6qJpi --> | says <!-- col:5frxowOc --> | value <!-- col:sCynsuQ9 --> <!-- id:eH51j0oy --> |
| --- | --- | --- | --- |
| `schemaDefinition` | the type's home page | "I **define** a schema." | `ipfs://<cid>` of the schema blob <!-- id:tVs5x_v9 --> |
| `attributesSchema` | an instance page | "**My** attributes follow that schema." | the type page's `hm://` URL (or `ipfs://<cid>`) <!-- id:f2x5Zwyu --> |
| `childAttributesSchema` | a folder | "My **children's** attributes follow that schema." | the type page's `hm://` URL (or `ipfs://<cid>`) <!-- id:0hFAtMVX --> |

<!-- id:ZCC3PFGn -->
- An **attributes schema is a plain struct** of the fields a document's metadata carries — [person-doc](../../example/person-doc.md) is `{surname required, givenName}`. It never extends [document](../../document.md) and never mentions `metadata` or `content`. Build one type on another by extending the struct: [employee](../../example/employee.md) = [person](../../example/person.md) + `employeeId`. <!-- id:Na4vgmEz -->
- A document's **effective** schema: its own `attributesSchema`, else its parent's `childAttributesSchema`, else none. One level — a folder types its direct children. <!-- id:gl8pcEeb -->
- When a document is **checked**, the base [metadata](../../metadata.md) fields (name, summary, icon, the three keys, …) are folded in beneath the type's fields and the result stays open to extra keys, so a typed page is still a full document with a body. <!-- id:7GRIwm83 -->
- A type has a **URL** because its home page does: `hm://acme/person` resolves through that page's `schemaDefinition` to the blob. Reference by URL to follow the type as it evolves, by CID to pin it ([pinning versus following](../../schema/typed-documents.md)). <!-- id:Yl8Ey-8l -->

The worked demo is [the World Builder](../world-builder.md): a world page typed by [world-doc](../../example/world-doc.md), four type pages, four folders bound with `childAttributesSchema`, starter pages with dates, title pills and linked objects. <!-- id:RyEKNX6z -->

# Working with them <!-- id:YH1dmbLS -->

## In the app <!-- id:XRBTxA4Y -->

- A type's home page (any document with `schemaDefinition`) shows **New Document** — a draft whose `attributesSchema` is the page — and **New Collection** — a draft whose `childAttributesSchema` is the page. The options menu adds **Extend Schema**, **New Raw Value** (a bare IPFS blob of the type, for developers), and **Inspect Schema**. **New Schema** (Developer Mode) opens the editor pointed at the meta-schema. <!-- id:Jf-V7RjD -->
- Any document's **Attributes** tab opens with its two schema bindings — **Attributes schema** and **Children attributes schema** — each with the full schema editor in place when the document owns the schema (the options menu's **Attributes Schema** / **Children Attributes Schema** entries jump there and draft an empty struct when nothing is bound). Publishing freezes edits into IPFS objects the binding keys point at. <!-- id:MxDZu2Xj -->
- A typed document's **Attributes** tab shows the type's required fields as fixed rows, the optional ones as chips, the right control per field (date picker, title pill, file picker, dropdown), and violations in red — never blocking a save. <!-- id:7I4iLDes -->

## With the CLI <!-- id:fOfjpD4m -->

`seed-cli` reads the same library and resolves references the same way the app does. Reference: [the CLI reference](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/cli/docs/CLI-REFERENCE.md). <!-- id:WPRUahTQ -->

```sh <!-- id:5ZlBShDv -->
# type a document, a folder, and publish a type
seed-cli document create -f bob.md --attributes-schema hm://acme/person
seed-cli document update hm://acme/people --child-attributes-schema hm://acme/person
seed-cli document create -f person.md --schema-definition person.schema.json   # publishes the blob, binds schemaDefinition
# frontmatter works too: attributesSchema: hm://acme/person  /  childAttributesSchema: …  /  schemaDefinition: ipfs://…

# check
seed-cli document validate hm://acme/people/bob          # effective schema, each violation on a line, exit 1 on any
seed-cli document validate hm://acme/people/bob --content --json
seed-cli space import self -d ./site --check              # every file against its schema; publishes nothing on a violation
seed-cli schema get hm://acme/person --resolve            # the schema, references followed, extensions merged

# find
seed-cli query acme --where 'attributesSchema=hm://acme/person'   # every page typed by person (any attribute condition works)
seed-cli query '*' --where 'has:childAttributesSchema'              # every typed folder, anywhere
seed-cli attributes acme                                            # which attribute keys documents carry, with kinds
seed-cli attributes acme --values status                            # the distinct values of one key
seed-cli schema validate ipfs://<cid>                     # is this blob a valid Hypermedia schema?

# raw objects
seed-cli blob create -f value.json --schema hm://acme/person   # validate, publish, link the blob to its type
seed-cli blob validate -f value.json --schema hm://acme/person
seed-cli blob verify ipfs://<cid>                              # signature + schema of a published blob
```

## From code (`@seed-hypermedia/client`) <!-- id:AYM44IlE -->

The SDK is the single implementation every surface shares; the CLI and the agents service call these same functions. <!-- id:UowHRXUw -->

```ts <!-- id:wEfsPT8s -->
import {HM_SCHEMAS, validate, resolveSchema, structFields} from '@seed-hypermedia/client/schema-engine'
import {
  classifyRef, resolveSchemaRef, loadSchemaRef, hydrateSchemaRegistry,
  effectiveSchemaRef, checkDocumentSchema, checkSchemaDefinition,
  metadataSchemaOf, documentMetadataSchema, blobSchemaRef, withoutSchemaLink,
} from '@seed-hypermedia/client/schema-resolve'

validate(HM_SCHEMAS['example/person'], {name: 'Bob', age: 41})            // [] — errors as "$.path: message" strings
const person = await loadSchemaRef(client, 'hm://acme/person')            // {schema, cid, registry} — refs fetched
validate(person.schema, value, '$', {}, person.registry)
await checkDocumentSchema(client, docId, doc.metadata)                    // {schema, via: 'own'|'inherited'|'none', required, missing, violations}
await checkSchemaDefinition(client, 'ipfs://<cid>')                       // violations of the meta-schema, or why it failed to load
await client.request('QueryDocuments', {filter: {comparison: {key: 'attributesSchema', operator: 'EQUAL', value: {stringValue: 'hm://acme/person'}}}})
await client.request('ListDocumentAttributeNames', {account: 'acme'})    // keys documents carry, with kinds
await client.request('ListDocumentAttributeValues', {path: ['status'], kind: 'DOCUMENT_ATTRIBUTE_KIND_STRING'})
documentMetadataSchema(metadataSchemaOf(person.schema))                   // the open, base-folded metadata schema the editor uses
```

<!-- id:OAh4Rwf9 -->
- `classifyRef` sorts a reference into a bundled library name, a CID, or a document URL without fetching; `resolveSchemaRef` follows it (a document URL → its `schemaDefinition` → the blob). <!-- id:yXAkWi-5 -->
- `effectiveSchemaRef` applies the own-else-parent rule; `hydrateSchemaRegistry` fetches every type a schema references so nested `ref`s validate. <!-- id:-xfW1N_s -->
- `QueryDocuments` takes a recursive `DocumentFilter` (`and` / `or` / `not`, `comparison`, `exists` / `missing`, `stringMatch`, `spaceMatch`, `pathMatch`, `urlMatch`) in protobuf JSON, sorts by attribute or built-in field, and pages; the two attribute listings answer "which keys exist" and "which values does this key take". The Explore grammar compiles to the same filter: `compileExploreQuery(parseExploreQuery(q), {type: 'node'}).filter?.toJson()` from the shared package. <!-- id:nanymnNJ -->
- Generated TypeScript for the whole library ships as `schema-types.generated.ts` (`HMDocument`, `HMMetadata`, `HMChange<B>`, …), from `scripts/hypermedia/typegen.mjs`. <!-- id:ZZ1mAdzM -->

## Through an agent <!-- id:Ey4TdXUX -->

The agent verbs ([read](../../agent/read.md), [write](../../agent/write.md)) expose the same checks; conformance is advisory for documents and a refusal for raw objects. <!-- id:Guzac8bT -->
  - `read hm://acme/people/bob` — a typed document returns a `schema` block: `{schema, via, required, missing, violations}`. `/:attributes` reads only the metadata. <!-- id:RvJqxIgz -->
  - `read ipfs://<cid>` — a DAG-CBOR object decodes to `value`, `signature` (who signed, whether it verifies), and `schema` (violations against the schema it links to, or `options: {schema}`). <!-- id:aOFSWTfh -->
  - `write hm://acme/people/bob` with `options.metadata: {surname: "Smith", attributesSchema: "hm://acme/person"}` — any key is allowed; the result reports `schema` and `warnings` beside the published id. `options.metadata.childAttributesSchema` types a folder; `options.metadata.schemaDefinition` makes a page a type. `dryRun: true` returns the same report without publishing. <!-- id:jlfZ4SiX -->
  - `call` tool `query` with `q` in the Explore grammar — `attributesSchema=hm://acme/person` (every page typed by person), `in:hm://acme/places kind=fortress`, `has:childAttributesSchema`, `status="In Progress" AND priority>=3` — or a raw `filter`; returns each document with its full attributes, sortable and paged. `call` tool `attributes` lists the attribute keys documents carry (with kinds) or, with `key`, the distinct values of one key. <!-- id:Y5C1myTU -->

<!-- id:heOd2jXW -->
- `write ipfs://` with JSON `content` and `options: {schema: "hm://acme/person"}` — validated, refused on a violation (`force: true` publishes anyway with `warnings`), published with a `schema` link; `options.schema: "hypermedia-schema"` publishes a schema blob after checking it against the meta-schema; `options.sign: true` signs a blob whose type extends [blob](../../blob.md). <!-- id:KvQdVNuh -->

# Who can check what <!-- id:Emb84qw3 -->

<!-- id:6w1mDiJR -->
| check <!-- col:uHLqTxKK --> | app <!-- col:gnzMVi5D --> | CLI <!-- col:Ns7OZ6Dp --> | SDK <!-- col:7jEnbHjn --> | agent <!-- col:-LGOrIwr --> <!-- id:kdoR2ikK --> |
| --- | --- | --- | --- | --- |
| a document against its effective schema | Attributes tab, live | `document validate`, `space import --check` | `checkDocumentSchema` | `read` → `schema`; `write` → `warnings` <!-- id:5IqlaciT --> |
| a `schemaDefinition` is a valid schema | schema editor, live | `schema validate` | `checkSchemaDefinition` | `write` → `warnings` <!-- id:M6OmkQ1C --> |
| a raw object against a type | value editor, live | `blob validate`, `blob create` | `validate` + `loadSchemaRef` | `read ipfs://`, `write ipfs://` (refuses) <!-- id:TPh1S_Dr --> |
| a signed blob's signature | inspector | `blob verify` | `verifySignedBlob` | `read ipfs://` → `signature` <!-- id:B-puiZbk --> |
| resolve a type by URL, CID or name | schema browser | `schema get [--resolve]` | `resolveSchemaRef`, `loadSchemaRef` | `read hm://` (type page), `read ipfs://` (blob) <!-- id:ILY7c43w --> |
| find documents by attribute, or typed by a schema | Explore (advanced search) | `query --where`, `query --filter` | `QueryDocuments` | `call` → `query` <!-- id:dC9EEwVd --> |
| which attribute keys exist, and their values | Explore's attribute pickers | `attributes`, `attributes --values` | `ListDocumentAttributeNames`, `ListDocumentAttributeValues` | `call` → `attributes` <!-- id:p0-yKm3E --> |
