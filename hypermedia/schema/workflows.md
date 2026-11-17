---
name: Schema Workflows
summary: The things a person does with Hypermedia Schemas and documents, from reading a type to publishing one, each with its steps in the Seed app, the CLI and through an agent.
---
This page gives the steps for each thing a person does with [Hypermedia Schemas](../schema.md): read a type, type a document or a folder, check a document, find typed documents, and define a type. [Typed blob workflows](./blob-workflows.md) continues with raw objects and signed blobs. Each workflow has steps for three surfaces: the **Seed app** (desktop and web), the **CLI** (`seed-cli`), and an **agent** (the `read` and `write` tools of [Seed Agents](../agent.md)). [Typed documents](./typed-documents.md) explains the model underneath, and [the schema language](./schema-language.md) explains the vocabulary.

# Before you start <!-- id:aNQZP66c -->

**The app.** Typed documents need no setting: any [document](../protocol/documents.md)'s **Attributes** tab shows its schema bindings. On desktop, two menu entries sit behind a switch: **Schema** in the **New** menu, and **New World…** in a document's options menu ([the World Builder](./world-builder.md)). To show them, open Settings, Developers, press **Enable Debug Tools**, then turn on **Hypermedia Schemas**. Validation is advisory everywhere in the app: a value that breaks its schema is marked in red and is never refused. See [the rationale](./why.md).

**The CLI.** Point it at the node you are working with and sign with a key it holds. Use `--server http://localhost:58004` for the desktop dev app's API, `--server https://hyper.media` (the default) for the public [gateway](../protocol/sites.md), and `--key <name>` for the signing key (`key list` shows them). `--dev` selects the development keyring. The command reference is [CLI](../build/cli.md), and [keys](../build/keys.md) covers the keyring. <!-- id:l0yc6wyb -->

**An agent.** An agent reads hypermedia with `read <address>` and publishes with `write <address>`. Publishing needs the **publish** [grant](../agent/grants.md) on the agent. The contracts are in [tools](../agent/tools.md), and the verbs have their own pages: [read](../agent/read.md) and [write](../agent/write.md). <!-- id:jCZEzRiL -->

**Names used below.** `<acct>` is an [account](../protocol/identity.md) id such as `z6Mk…`. `<library>` is the key of the space the library is published to. Every library schema has a page at `hm://<library>/<name>`, where the name is its path in the library, so `hm://<library>/document` is the base document type. Inside schema files the library is written `hm://hyper.media/<name>`. That is a name the SDK resolves and the network does not, so a URL you open needs the key. See [references and naming](./references.md).

# Read a document and its type <!-- id:AMFjgZzp -->

A document is its [metadata](../metadata.md) (name, summary, icon, the schema fields) and its content, a tree of [blocks](../protocol/blocks.md). You can follow the types all the way down to the [kinds](./kind.md) of value they are built from.

**In the app** <!-- id:nnKMNDW8 -->
  1. Open any document. The **Attributes** tab lists its metadata as editable fields. The **Content** tab is the block tree. <!-- id:6ySwBrba -->
  2. Open `hm://<library>/document`. The page explains the type in prose and shows its schema above the body: `metadata` and `content`, each a link. Follow `metadata` to [metadata](../metadata.md) for every built-in key, including `attributesSchema`, `childAttributesSchema` and `schemaDefinition`. Follow `content` to [block/node](../block/node.md) and on to the block types. <!-- id:0daJUHUr -->
  3. Every type name on those pages is a link, down to the nine kinds in [the data model](./data-model.md). **Inspect Schema** in a type page's menu opens the same schema by [CID](../protocol/blobs.md) at `/hm/schema/<cid>`, with its dependencies and dependents. A schema blob with no defining document opens there on its own. <!-- id:jRqwN-xe -->
  4. Each schema shows its fields with kinds and required flags, union variants, inherited and added fields for an extension, generic parameters, its published [`hm://` URL](../hm-url.md) and [CID](../protocol/blobs.md), and its source [dag-json](./dag-json.md). <!-- id:K_Hww_2j -->

**With the CLI** <!-- id:fOPHu9gf -->
  1. `document get --md hm://<acct>/<path>` prints the document as markdown: the metadata as YAML frontmatter, and the blocks with their ids in trailing comments. <!-- id:ZTyY0oGQ -->
  2. `document get --json hm://<acct>/<path>` prints the document as the API returns it. `document get -m` prints the metadata only. <!-- id:2YhQdcMj -->
  3. `document get --md hm://<library>/document` reads the type page like any other. `schema get document` prints the schema it defines, and `schema get --resolve` prints the same schema with every reference followed and extensions merged. `blob get <cid>` reads any blob back as [dag-json](./dag-json.md). <!-- id:pZdlc6-t -->
  4. `document validate hm://<acct>/<path>` names the schema a document conforms to and how it got it (its own `attributesSchema`, or inherited from the parent's `childAttributesSchema`). If the document has none, it says so. <!-- id:EGiX5lnq -->

**Through an agent** <!-- id:rHb3ns_h -->
  1. `read hm://<acct>/<path>` returns the document as markdown with frontmatter, the same picture the CLI gives. `/:attributes` after the address reads only the metadata. <!-- id:qjfRlvIg -->
  2. `read hm://<library>/document` reads the type page. `read ipfs://<cid>` fetches a file into memory, and `read ipfs://<cid>` of a [DAG-CBOR](./dag-cbor.md) object decodes it (its value, signature check and schema check). A read of a typed document also returns a `schema` block: the type, how it was bound, and any missing required fields. <!-- id:Ez-m69u7 -->

# Give a document custom attributes and a type <!-- id:jnJM95xh -->

You add your own attributes to a document, such as `surname`, `status` and `born`. When the document should be a kind of thing, you say which type it conforms to, so the attributes are checked.

**In the app** <!-- id:9NjDgrYx -->
  1. Open the document and switch to the **Attributes** tab. <!-- id:MzKMGOOq -->
  2. Press **Add field**. Enter the **Field name**, pick its **Type** (text, number, toggle, list, object, link…), and enter the value. Save or publish as with any edit. <!-- id:z1CMaGyt -->
  3. To type the document, add the field `attributesSchema` and set it to the type document's URL (`hm://<acct>/types/person`). The field is a document reference, so it offers a search and shows the target as a title pill. The type's required fields appear as fixed rows at once. <!-- id:h3tBTXeu -->
  4. Or start from the type: its page has a **New Document** button, which starts a draft whose `attributesSchema` is that page.

**With the CLI** <!-- id:RhZhfOGp -->
  1. `space export hm://<acct> ./site` writes every document to a markdown file whose frontmatter carries every metadata key. Add `surname: Smith` (and `attributesSchema: hm://<acct>/types/person`) to the file and run `space import hm://<acct> ./site --key <name>`. Only the changed document publishes. <!-- id:IvCAUrCj -->
  2. `document create -f page.md` keeps every frontmatter key: `surname: Smith` in the file becomes `surname` on the document. <!-- id:pNoTGuIK -->
  3. `document update hm://<acct>/<path> --metadata '{"surname":"Smith"}'` sets any attribute from the command line, and `--attributes-schema hm://<acct>/types/person` types the document. Both flags work on `create` too, and a flag wins over the file. <!-- id:DZ8eFUBI -->

**Through an agent** <!-- id:Oo3bqROi -->
  1. Call `write hm://<acct>/<path>` with `options: {action: "update", metadata: {surname: "Smith", attributesSchema: "hm://<acct>/types/person"}}`. `options.metadata` is merged into the document's metadata and accepts custom keys. `dryRun: true` echoes what would publish. <!-- id:nCAjOm-h -->

# Type every page in a folder <!-- id:McbpSdEO -->

You make a folder typed. Every page created directly under it is a person, a place or an event, without setting `attributesSchema` on each one by hand.

**In the app** <!-- id:iqobHnqn -->
  1. Open the folder document's **Attributes** tab. <!-- id:KK8Er4JX -->
  2. Add the field `childAttributesSchema` and point it at the type document (`hm://<acct>/types/person`). It uses the same search pill as `attributesSchema`. The type page's **New Collection** button does the same on a new draft. <!-- id:FC5f_ip4 -->
  3. Create a page under the folder. Its required attributes are already there as fixed rows, and its Attributes tab says which type it inherits. A child that sets its own `attributesSchema` uses that instead. See [typed documents](./typed-documents.md) for the inheritance rule. <!-- id:pHOiP3Yo -->

**With the CLI** <!-- id:9R7QXi7j -->
  1. Run `document update hm://<acct>/people --child-attributes-schema hm://<acct>/types/person`. Or put `childAttributesSchema: hm://<acct>/types/person` in the folder's frontmatter, then run `document create -f` or `space import`. <!-- id:cjn_V23c -->

**Through an agent** <!-- id:wlrYixCC -->
  1. Call `write hm://<acct>/people` with `options: {action: "update", metadata: {childAttributesSchema: "hm://<acct>/types/person"}}`. <!-- id:ZUGHwsZT -->

# Check a document against its schema <!-- id:yGb63zYD -->

Wherever you edit a typed document, the editor tells you what the type requires and what is out of spec. It never stops you saving.

**In the app** <!-- id:tcvWFOIf -->
  1. Open a typed document (typed by its own `attributesSchema`, or by the parent's `childAttributesSchema`). The type's required fields are always-visible rows at the top of the **Attributes** tab and above the body in the **Content** tab. They cannot be removed. <!-- id:zEs9xjkx -->
  2. A field gets the control its type calls for: a dropdown for a union of [literals](./literal-schema.md), a date picker for a date, a searchable title pill for a document reference, and a file picker for an IPFS reference. <!-- id:eVZIyat1 -->
  3. A value that breaks the schema shows a red badge on the field naming the rule ("surname is required", "status must be one of draft, published, archived"). Saving still works. <!-- id:5K-lLqtH -->
  4. The Attributes tab suggests the schema's optional fields as chips. Pressing one adds the field with a conforming starting value. <!-- id:FfbnAjlb -->

**With the CLI** <!-- id:RzEbdruT -->
  1. `document validate hm://<acct>/<path>` resolves the document's effective attributes schema (its `attributesSchema`, else the parent's `childAttributesSchema`), fetches every type it references, and checks the metadata. It prints each violation on its own line (`$.born: does not match pattern for format "date"`) and exits with code 1 when there are any. `--content` checks the whole document, and `--json` reports `{schema, via, violations}`. <!-- id:yLJ2_4AB -->
  2. `space import self -d ./site --check` runs the same check over every file. A file's parent in the folder supplies the inherited type, and the site's parent document supplies it when the folder has none. Nothing publishes while any file would violate its schema. <!-- id:e4MxYB4W -->

**Through an agent** <!-- id:XFxKCawf -->
  1. `read hm://<acct>/<path>` of a typed document returns a `schema` block, `{schema, via, required, missing, violations}`. It names the type, says whether the type came from the document's own `attributesSchema` or was inherited, and lists what is out of spec. A `write` to a typed document returns the violations as `warnings` beside the published id, and publishes anyway, because validation is advisory. `dryRun: true` returns the same warnings without publishing. <!-- id:U9EmE1SJ -->

# Find documents by type or attribute

A typed attribute is an ordinary document attribute, so the document query finds typed pages. The [query grammar](../build/query-grammar.md) is the same on every surface.

**In the app**
  1. Open Explore, the advanced search. Its attribute pickers list the attribute keys documents carry and the values each key takes.

**With the CLI**
  1. `query <acct> --where 'attributesSchema=hm://<acct>/types/person'` lists every page typed by person. Any attribute condition works.
  2. `query '*' --where 'has:childAttributesSchema'` lists every typed folder, anywhere.
  3. `attributes <acct>` lists which attribute keys documents carry, with kinds. `attributes <acct> --values status` lists the distinct values of one key.

**Through an agent**
  1. `call` the tool `query` with `q` in the same grammar, or a raw `filter`. Examples of `q`: `attributesSchema=hm://<acct>/types/person`, `in:hm://<acct>/places kind=fortress`, `has:childAttributesSchema`, `status="In Progress" AND priority>=3`. It returns each document with its full attributes, sortable and paged.
  2. `call` the tool `attributes` to list the attribute keys documents carry, with kinds. With `key`, it lists the distinct values of one key.

# Define a type and publish it <!-- id:J1U8mODk -->

You publish a type of your own, such as a Person or a Vote, as a document others can point at by URL. The document's metadata key `schemaDefinition` links the schema blob.

**In the app** <!-- id:IktlOkiJ -->
  1. Choose **New**, then **Schema** (with the Hypermedia Schemas switch on). A draft opens with an empty schema shown above the body. <!-- id:tXUATP1_ -->
  2. Give the document a name, and write a description in the body. The schema itself carries neither. The page carries them. <!-- id:RIVfC-ds -->
  3. Press **Edit** on the schema section. In the editor, use **Add field** for each [property](./property.md): its **Field name**, its type (picked from every type document, plus the built-ins: text, number, date, HM link, IPFS…), whether it is required, and a description. A union or a list is edited in the same form. **Schema JSON** switches to editing the schema as text. <!-- id:lq5g88L3 -->
  4. Publish. The working schema is frozen into a DAG-CBOR blob, and the document's `schemaDefinition` points at it. The page now shows a schema tag in its header and a **Create** button. <!-- id:JwxifnQe -->
  5. To build on an existing type, open its page and choose **Extend Schema**. The new draft starts as `{type: <that type>}` plus your fields, which is an [extension](./extension.md). An attributes schema for a typed document is a plain struct of attributes. It never extends `hm://hyper.media/document`. See [typed documents](./typed-documents.md).
  6. A schema can also live with no page. Choose **New Schema** from the options menu of the inspector or of a schema's page at `/hm/schema/<cid>`. The editor opens against the meta-schema, so the form offers only choices a valid schema can make. Publishing stores the schema as a content-addressed [blob](../protocol/blobs.md) that you can reference by CID. <!-- id:ggmcQl7m -->
  7. To give a document or a folder fields without a separate type page, choose **Attributes Schema** or **Children Attributes Schema** from its options menu and add the fields there. [Typed documents](./typed-documents.md) describes this in-page schema.

**With the CLI** <!-- id:U6i9oiV8 -->
  1. Write the schema as dag-json next to the page: `types/person.md` and `types/person.schema.json`. `space import hm://<acct> ./site --key <name>` encodes the schema to its CID, publishes the blob, and binds it to the document as `schemaDefinition`. See [publish a folder](../build/publish-a-folder.md). <!-- id:PwwtiTUC -->
  2. `schema validate person.schema.json` checks the file against the [meta-schema](../schema.md) first. It also takes an `ipfs://` CID or a type document's URL. <!-- id:Eb_yjidc -->
  3. `document create -f person.md -p types/person --schema-definition person.schema.json` publishes the page and the schema blob together in one command, and binds them. `document update … --schema-definition` rebinds an existing page. <!-- id:gQHfxmM2 -->

**Through an agent** <!-- id:t6nL0N72 -->
  1. Call `write ipfs://` with the schema as JSON `content` and `options: {schema: "schema"}`. This validates it against the meta-schema, publishes the schema blob, and returns its CID. Then call `write hm://<acct>/types/person` with `options: {name: "Person", metadata: {schemaDefinition: "ipfs://<cid>"}}` to bind the blob to a type page. A `schemaDefinition` that is not a valid schema comes back as a `warning`. <!-- id:sC-PJ9DS -->

# Which surface runs which check <!-- id:Emb84qw3 -->

The resolver, the validator and the signing rule live in `@seed-hypermedia/client` (`schema-engine`, `schema-resolve`, `signed-blob`). The app, the CLI and the app environment share that code, so every surface agrees about what a schema means. See the [SDK](../build/sdk.md).

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

The editors warn and never block. The CLI's checks exit with an error, and `blob create` and an agent's `write ipfs://` refuse a raw object that does not conform unless forced.

# See also <!-- id:WvQ9u3os -->

- [Typed documents](./typed-documents.md): the model behind typing a document or a folder. <!-- id:Iu1HdDPV -->
- [Typed blob workflows](./blob-workflows.md): create an object of a type, define a signed blob type, sign an instance.
- [The World Builder](./world-builder.md): a worked demo of typed documents in the app. <!-- id:DqFcZuXR -->
- [Schema language](./schema-language.md): the vocabulary every schema here is written in. <!-- id:XVvSRiPR -->
- [Network blobs](./blobs.md): the envelope and the built-in signed blob types. <!-- id:G0ynL-ym -->
- [CLI](../build/cli.md): the full command reference. <!-- id:DJbzyR0z -->
- [Seed Agents](../agent.md): the runtime behind the `read` and `write` tools. <!-- id:bI7pY-Nh -->
