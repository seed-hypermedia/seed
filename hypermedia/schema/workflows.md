---
name: Schema Workflows
summary: This page gives numbered steps for each task with Hypermedia Schemas and documents, from reading a type to publishing one, in the Seed app, with the CLI and through an agent.
---
This page shows how to do each common task with [Hypermedia Schemas](../schema.md). A schema describes what some data must look like, and a document that follows one is a [typed document](./typed-documents.md). The tasks are: read a type, type a document or a folder, check a document, find typed documents, and define a type.

Each task has steps for three surfaces: the [Seed app](../software/desktop.md) (desktop and web), the CLI (`seed-cli`), and an agent (the `read` and `write` tools of [Seed Agents](../agent.md)). [Typed blob workflows](./blob-workflows.md) continues with raw objects and signed blobs. [The schema language](./schema-language.md) explains the words a schema is written in.

# Before you start <!-- id:aNQZP66c -->

**The app.** Typed documents need no setting. The **Attributes** tab of any [document](../protocol/documents.md) shows its schema bindings. On desktop, two menu entries sit behind a switch: **Schema** in the **New** menu, and **New World…** in a document's options menu ([the World Builder](./world-builder.md)). To show them:
  1. Open Settings.
  2. Choose **Advanced**.
  3. In the **Developers** card, press **Enable Debug Tools**.
  4. Turn on **Hypermedia Schemas**.

The app only warns about a value that breaks its schema. It marks the value in red and never refuses it. See [the rationale](./why.md).

**The CLI.** Point the CLI at the server you work with, and sign with a key it holds. <!-- id:l0yc6wyb -->
  - `--server https://hyper.media` is the default. It is the public [gateway](../protocol/sites.md).
  - `--server http://localhost:58004` is the API of the desktop dev app.
  - `--key <name>` chooses the signing key. `key list` shows the keys.
  - `--dev` is a shortcut for the dev network. It sets the server to `https://dev.hyper.media` and uses the development keyring.
  - Do not use `--dev` and `--server` together. The CLI stops with an error if you do.

The command reference is [CLI](../build/cli.md), and [keys](../build/keys.md) covers the keyring.

**An agent.** An agent reads hypermedia with `read <address>` and publishes with `write <address>`. Publishing needs the **publish** [grant](../agent/grants.md) on the agent. The contracts are in [tools](../agent/tools.md). The verbs have their own pages: [read](../agent/read.md) and [write](../agent/write.md). <!-- id:jCZEzRiL -->

**Names used below.** `<acct>` is an [account](../protocol/identity.md) id such as `z6Mk…`. `<library>` is the key of the [space](../protocol/spaces.md) the library is published to. Every library schema has a page at `hm://<library>/<name>`, where the name is its path in the library. So `hm://<library>/document` is the base document type. Inside schema files the library is written `hm://hyper.media/<name>`. The SDK resolves that name and the network does not, so a URL you open needs the key. See [references and naming](./references.md).

# Read a document and its type <!-- id:AMFjgZzp -->

A document is its [metadata](../metadata.md) (name, summary, icon, the schema fields) and its content, a tree of [blocks](../protocol/blocks.md). You can follow the types all the way down to the [kinds](./kind.md) of value they are built from.

The **Schema view** is the app's view of one schema. It shows the schema's fields, its union arms, what it depends on and what depends on it. A type page shows the Schema view above its body. A schema with no page opens in the Schema view at `/hm/schema/<cid>`, under a **Schema** tag.

**In the app** <!-- id:nnKMNDW8 -->
  1. Open any document. The **Attributes** tab lists its metadata as fields you can edit. The **Content** tab is the block tree. <!-- id:6ySwBrba -->
  2. Open `hm://<library>/document`. The page explains the type in prose and shows its schema above the body: `metadata` and `content`, each a link. <!-- id:0daJUHUr -->
  3. Follow `metadata` to [metadata](../metadata.md). It lists every built-in key, including `attributesSchema`, `childAttributesSchema` and `schemaDefinition`.
  4. Follow `content` to [block/node](../block/node.md) and on to the block types. Every type name is a link, down to the nine kinds in [the data model](./data-model.md). <!-- id:jRqwN-xe -->
  5. Read the Schema view of each type. It shows the fields with their kinds and required flags, the union variants, the inherited and added fields of an extension, the generic parameters, the published [`hm://` URL](../protocol/urls.md) and [CID](../cid.md), and the source [dag-json](./dag-json.md). <!-- id:K_Hww_2j -->
  6. To see the raw blob, choose **Inspect Schema** in the type page's options menu. It opens the schema blob in the inspector, the screen that shows any blob by its CID.

**With the CLI** <!-- id:fOPHu9gf -->
  1. `document get --md hm://<acct>/<path>` prints the document as markdown. The metadata is YAML frontmatter, and each block's id follows the block. <!-- id:ZTyY0oGQ -->
  2. `document get --json hm://<acct>/<path>` prints the document as the API returns it. `document get -m hm://<acct>/<path>` prints the metadata only. <!-- id:2YhQdcMj -->
  3. `document get --md hm://<library>/document` reads the type page like any other page. <!-- id:pZdlc6-t -->
  4. `schema get document` prints the schema that page defines. `schema get --resolve document` prints the same schema with every reference followed and every extension merged.
  5. `blob get <cid>` reads any blob back as [dag-json](./dag-json.md).
  6. `document validate hm://<acct>/<path>` names the schema a document follows and how it got it: its own `attributesSchema`, or the parent's `childAttributesSchema`. If the document has no schema, it says so. <!-- id:EGiX5lnq -->

**Through an agent** <!-- id:rHb3ns_h -->
  1. `read hm://<acct>/<path>` returns the document as markdown with frontmatter, the same picture the CLI gives. Add `/:attributes` after the address to read only the metadata. A read of a typed document also returns a `schema` block: the type, how it was bound, and any missing required fields. <!-- id:qjfRlvIg -->
  2. `read hm://<library>/document` reads the type page. <!-- id:Ez-m69u7 -->
  3. `read ipfs://<cid>` fetches what the CID names. A file is loaded into memory. A [DAG-CBOR](./dag-cbor.md) object is decoded, with its value, its signature check and its schema check.

# Give a document custom attributes and a type <!-- id:jnJM95xh -->

You can add your own attributes to a document, such as `surname`, `status` and `born`. When the document is one of a kind of thing, you say which type it follows. Then the attributes are checked.

**In the app** <!-- id:9NjDgrYx -->
  1. Open the document and switch to the **Attributes** tab. <!-- id:MzKMGOOq -->
  2. Press **Add field**. <!-- id:z1CMaGyt -->
  3. Enter the **Field name**, pick the type of the field (text, number, toggle, list, object, link…), and enter the value.
  4. Save or publish, as with any edit.
  5. To type the document, add the field `attributesSchema` and set it to the type document's URL (`hm://<acct>/types/person`). The field is a document reference, so it offers a search and shows the target as a title pill. The type's required fields appear at once as fixed rows. <!-- id:h3tBTXeu -->

You can also start from the type. Its page has a **New Document** button, which starts a draft whose `attributesSchema` is that page.

**With the CLI** (three ways, pick one) <!-- id:RhZhfOGp -->
  1. Export, edit, import. `space export hm://<acct> -d ./site` writes every document to a markdown file. The frontmatter of each file holds every metadata key. Add `surname: Smith` (and `attributesSchema: hm://<acct>/types/person`) to the file. Then run `space import hm://<acct> -d ./site --key <name>`. Only the changed document publishes. <!-- id:IvCAUrCj -->
  2. Create from a file. `document create -f page.md` keeps every frontmatter key: `surname: Smith` in the file becomes `surname` on the document. <!-- id:pNoTGuIK -->
  3. Update with flags. `document update hm://<acct>/<path> --metadata '{"surname":"Smith"}'` sets any attribute from the command line. Add `--attributes-schema hm://<acct>/types/person` to type the document. Both flags work on `create` too, and a flag wins over the file. <!-- id:DZ8eFUBI -->

**Through an agent** <!-- id:Oo3bqROi -->
  1. Call `write hm://<acct>/<path>` with `options: {action: "update", metadata: {surname: "Smith", attributesSchema: "hm://<acct>/types/person"}}`. The agent merges `options.metadata` into the document's metadata, and custom keys are allowed. `dryRun: true` shows what would publish. <!-- id:nCAjOm-h -->

# Type every page in a folder <!-- id:McbpSdEO -->

You can make a folder typed. Then every page created directly under it is a person, a place or an event. You do not set `attributesSchema` on each page by hand.

**In the app** <!-- id:iqobHnqn -->
  1. Open the folder document's **Attributes** tab. <!-- id:KK8Er4JX -->
  2. Add the field `childAttributesSchema` and point it at the type document (`hm://<acct>/types/person`). It uses the same search pill as `attributesSchema`. <!-- id:FC5f_ip4 -->
  3. Create a page under the folder. Its required attributes are already there as fixed rows, and its Attributes tab says which type it inherits. <!-- id:pHOiP3Yo -->

The type page's **New Collection** button does steps 1 and 2 on a new draft. A child that sets its own `attributesSchema` uses that instead. See [typed documents](./typed-documents.md) for the inheritance rule.

**With the CLI** <!-- id:9R7QXi7j -->
  1. Run `document update hm://<acct>/people --child-attributes-schema hm://<acct>/types/person`. Or put `childAttributesSchema: hm://<acct>/types/person` in the folder's frontmatter, then publish the folder page with `document create` or `space import`. <!-- id:cjn_V23c -->

**Through an agent** <!-- id:wlrYixCC -->
  1. Call `write hm://<acct>/people` with `options: {action: "update", metadata: {childAttributesSchema: "hm://<acct>/types/person"}}`. <!-- id:ZUGHwsZT -->

# Check a document against its schema <!-- id:yGb63zYD -->

Wherever you edit a typed document, the editor tells you what the type requires and what does not match. It never stops you saving.

**In the app** <!-- id:tcvWFOIf -->
  1. Open a typed document. It is typed by its own `attributesSchema`, or by the parent's `childAttributesSchema`. <!-- id:zEs9xjkx -->
  2. Look at the required fields. They are rows that are always visible, at the top of the **Attributes** tab and above the body in the **Content** tab. You cannot remove them.
  3. Edit a field. Each field gets the control its type calls for: a dropdown for a union of [literals](./literal-schema.md), a date picker for a date, a searchable title pill for a document reference, and a file picker for an IPFS reference. <!-- id:eVZIyat1 -->
  4. Look for red badges. A value that breaks the schema shows a red badge on the field, and the badge names the rule ("surname is required", "status must be one of draft, published, archived"). Saving still works. <!-- id:5K-lLqtH -->
  5. Press a chip to add an optional field. The Attributes tab suggests the schema's optional fields as chips, and each one starts with a value that fits the schema. <!-- id:FfbnAjlb -->

**With the CLI** <!-- id:RzEbdruT -->
  1. Run `document validate hm://<acct>/<path>`. The command finds the document's effective attributes schema (its `attributesSchema`, else the parent's `childAttributesSchema`), fetches every type that schema names, and checks the metadata. <!-- id:yLJ2_4AB -->
  2. Read the result. Each violation is on its own line (`$.born: does not match pattern for format "date"`). The exit code is 1 when there is any violation. With `--json` the report is `{id, schema, via, violations}`.
  3. To check a whole folder of files, run `space import self -d ./site --check`. It runs the same check over every file. A file's parent in the folder gives the inherited type. When the folder has no parent file, the site's parent document gives it. Nothing publishes while any file breaks its schema. <!-- id:e4MxYB4W -->

**Through an agent** <!-- id:XFxKCawf -->
  1. `read hm://<acct>/<path>` of a typed document returns a `schema` block, `{schema, via, required, missing, violations}`. It names the type. It says whether the type came from the document's own `attributesSchema` or was inherited. It lists what does not match. <!-- id:U9EmE1SJ -->
  2. A `write` to a typed document returns the violations as `warnings` beside the published id. It publishes anyway, because the check only warns. `dryRun: true` returns the same warnings without publishing.

# Find documents by type or attribute

A typed attribute is an ordinary document attribute, so the document query finds typed pages. The [query grammar](../build/query-grammar.md) is the same on every surface.

**In the app**
  1. Open **Explore**, the advanced search. Its attribute pickers list the attribute keys that documents carry and the values each key takes.

**With the CLI**
  1. `query <acct> --where 'attributesSchema=hm://<acct>/types/person'` lists every page typed by person. Any attribute condition works.
  2. `query '*' --where 'has:childAttributesSchema'` lists every typed folder, anywhere.
  3. `attributes <acct>` lists which attribute keys documents carry, with their kinds. `attributes <acct> --values status` lists the distinct values of one key.

**Through an agent**
  1. `call` the tool `query` with `q` in the same grammar, or a raw `filter`. Examples of `q`: `attributesSchema=hm://<acct>/types/person`, `in:hm://<acct>/places kind=fortress`, `has:childAttributesSchema`, `status="In Progress" AND priority>=3`. The tool returns each document with its full attributes. You can sort and page the result.
  2. `call` the tool `attributes` to list the attribute keys documents carry, with their kinds. With `key`, it lists the distinct values of one key.

# Define a type and publish it <!-- id:J1U8mODk -->

You can publish a type of your own, such as a Person or a Vote, as a document that others point at by URL. The document's metadata key `schemaDefinition` links the schema blob.

**In the app** <!-- id:IktlOkiJ -->
  1. Choose **New**, then **Schema**. This needs the Hypermedia Schemas switch. A draft opens with an empty schema shown above the body. <!-- id:tXUATP1_ -->
  2. Give the document a name, and write a description in the body. The page is where people read about the type. A schema can hold a short `description` of its own, and it has no name. <!-- id:RIVfC-ds -->
  3. Press **Edit** on the schema section. The schema editor opens. <!-- id:lq5g88L3 -->
  4. Press **Add field** for each [property](./property.md). Enter its **Field name**, its type, whether it is required, and a description. You pick the type from every type document and from the built-in types (text, date, HM link, IPFS file / object…). A union or a list is edited in the same form. The **JSON** tab lets you edit the schema as text.
  5. Publish. The app freezes the working schema into a DAG-CBOR blob, and the document's `schemaDefinition` points at it. The page shows a schema tag in its header. For a [struct](../struct.md) of attributes it also shows **New Document** and **New Collection**. For a signed blob type it shows **Create**. <!-- id:JwxifnQe -->

Three more ways to define a schema in the app:
  - **Build on an existing type.** Open its page and choose **Extend Schema** in the options menu. The new draft starts as `{type: <that type>}` plus your fields, which is an [extension](./extension.md). An attributes schema for a typed document is a plain struct of attributes. It never extends `hm://hyper.media/document`. See [typed documents](./typed-documents.md).
  - **Make a schema with no page.** Choose **New Schema** from the options menu of the inspector, or of a schema's page at `/hm/schema/<cid>`. The editor opens against the meta-schema, so the form offers only choices a valid schema can make. Publishing stores the schema as a [blob](../protocol/blobs.md) that you reference by CID. <!-- id:ggmcQl7m -->
  - **Give a document or a folder fields without a separate type page.** Open its **Attributes** tab. Scroll to **Attributes schema** (for this document) or **Children attributes schema** (for the pages inside it). Press **Define**, then **Custom Attributes** or **Custom Children Attributes**, and add the fields. [Typed documents](./typed-documents.md) describes this in-page schema.

**With the CLI** (check first, then publish with step 2 or step 3) <!-- id:U6i9oiV8 -->
  1. Check it. `schema validate person.schema.json` checks the file against the [meta-schema](../schema.md). The command also takes an `ipfs://` CID or a type document's URL. <!-- id:Eb_yjidc -->
  2. Publish it with a folder. Write the schema as dag-json next to the page: `types/person.md` and `types/person.schema.json`. Then run `space import hm://<acct> -d ./site --key <name>`. It encodes the schema to its CID, publishes the blob, and binds it to the document as `schemaDefinition`. See [publish a folder](../build/publish-a-folder.md). <!-- id:PwwtiTUC -->
  3. Or publish it with one command. `document create -f person.md -p types/person --schema-definition person.schema.json` publishes the page and the schema blob together and binds them. `document update hm://<acct>/types/person --schema-definition person.schema.json` binds a new schema to a page that exists. <!-- id:gQHfxmM2 -->

**Through an agent** <!-- id:t6nL0N72 -->
  1. Call `write hm://<acct>/types/person` with `options: {name: "Person", metadata: {schemaDefinition: <the schema object>}}`. The agent checks the schema against the meta-schema, publishes the schema blob and the page together, and sets `schemaDefinition` to the blob's `ipfs://<cid>`. A schema that is not valid is refused, unless you force it. <!-- id:sC-PJ9DS -->
  2. Don't publish the schema alone with `write ipfs://` first. A blob that nothing public links to is [not public](../protocol/privacy.md), so the server can't read it, and a page whose `schemaDefinition` points at it is refused. `attributesSchema` and `childAttributesSchema` also take a schema object this way.

# Which surface runs which check <!-- id:Emb84qw3 -->

One piece of code resolves schemas, checks values and signs blobs. It lives in `@seed-hypermedia/client` (`schema-engine`, `schema-resolve`, `signed-blob`). The app, the CLI and the [app environment](../software/app-environment.md) share that code, so every surface agrees about what a schema means. See the [SDK](../build/sdk.md).

<!-- id:6w1mDiJR -->
| check <!-- col:uHLqTxKK --> | app <!-- col:gnzMVi5D --> | CLI <!-- col:Ns7OZ6Dp --> | SDK <!-- col:7jEnbHjn --> | agent <!-- col:-LGOrIwr --> <!-- id:kdoR2ikK --> |
| --- | --- | --- | --- | --- |
| a document against its effective schema | Attributes tab, live | `document validate`, `space import --check` | `checkDocumentSchema` | `read` → `schema`; `write` → `warnings` <!-- id:5IqlaciT --> |
| a `schemaDefinition` is a valid schema | schema editor, live | `schema validate` | `checkSchemaDefinition` | `write` → `warnings` <!-- id:M6OmkQ1C --> |
| a raw object against a type | value editor, live | `blob validate`, `blob create` | `validate` + `loadSchemaRef` | `read ipfs://`, `write ipfs://` (refuses) <!-- id:TPh1S_Dr --> |
| a signed blob's signature | inspector | `blob verify` | `verifySignedBlob` | `read ipfs://` → `signature` <!-- id:B-puiZbk --> |
| resolve a type by URL, CID or name | Schema view | `schema get [--resolve]` | `resolveSchemaRef`, `loadSchemaRef` | `read hm://` (type page), `read ipfs://` (blob) <!-- id:ILY7c43w --> |
| find documents by attribute, or typed by a schema | Explore (advanced search) | `query --where`, `query --filter` | `QueryDocuments` | `call` → `query` <!-- id:dC9EEwVd --> |
| which attribute keys exist, and their values | Explore's attribute pickers | `attributes`, `attributes --values` | `ListDocumentAttributeNames`, `ListDocumentAttributeValues` | `call` → `attributes` <!-- id:p0-yKm3E --> |

The editors warn and never block. The CLI's checks exit with an error. `blob create` and an agent's `write ipfs://` refuse a raw object that does not match its type, unless you force them.

# See also <!-- id:WvQ9u3os -->

- [Typed documents](./typed-documents.md): the model behind typing a document or a folder. <!-- id:Iu1HdDPV -->
- [Typed blob workflows](./blob-workflows.md): create an object of a type, define a signed blob type, sign an instance.
- [The World Builder](./world-builder.md): a worked demo of typed documents in the app. <!-- id:DqFcZuXR -->
- [Schema language](./schema-language.md): the vocabulary every schema here is written in. <!-- id:XVvSRiPR -->
- [Network blobs](./blobs.md): the envelope and the built-in signed blob types. <!-- id:G0ynL-ym -->
- [CLI](../build/cli.md): the full command reference. <!-- id:DJbzyR0z -->
- [Seed Agents](../agent.md): the runtime behind the `read` and `write` tools. <!-- id:bI7pY-Nh -->
