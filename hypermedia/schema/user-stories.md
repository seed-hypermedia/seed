---
name: "User Stories: Typed Documents and Blobs"
summary: What a person should be able to do with schemas through the Seed app, the CLI and an agent, with the exact steps to do and test each story on every surface.
---
These are the things a person should be able to do with the type system, written as stories. Each story says what the person wants, then gives the exact steps on each of three surfaces: the **Seed app** (desktop and web), the **CLI** (`seed-cli`, run from source with `bun run src/index.ts` in `frontend/apps/cli`, or `npx -y @seed-hypermedia/cli`), and an **agent** (the `read` and `write` tools of [Seed Agents](../agent.md)). Each set of steps is also the test for that surface: follow it and check the stated result. Every story ends with where each surface stands, and all of them now **work**. A closing section says which steps are automated and which are tested by hand. [Typed documents](./typed-documents.md) explains the model underneath, and [the schema language](./schema-language.md) explains the vocabulary. <!-- id:0uMy7lU9 -->

# Before you start <!-- id:aNQZP66c -->

**The app.** On desktop the schema features sit behind a switch. Open Settings, Developers, press **Enable Debug Tools**, then turn on **Hypermedia Schemas**. With it on, the **New** menu gains **Schema**, and a [document](../protocol/documents.md)'s options menu gains **New Blob**, **New Schema** and **New World…**. The web app shows **New Blob** and **New Schema** in the options menu by default. Validation is advisory everywhere: a value that breaks its schema is marked in red and is never refused. See [why Hypermedia Schemas](./why.md). <!-- id:5iiI8U-W -->

**The CLI.** Point it at the node you are working with and sign with a key it holds. Use `--server http://localhost:58004` for the desktop dev app's API, `--server https://hyper.media` (the default) for the public [gateway](../protocol/sites.md), and `--key <name>` for the signing key (`key list` shows them). `--dev` selects the development keyring. The command reference is [CLI](../build/cli.md), and [keys](../build/keys.md) covers the keyring. <!-- id:l0yc6wyb -->

**An agent.** An agent reads hypermedia with `read <address>` and publishes with `write <address>`. Publishing needs the **publish** [grant](../agent/grants.md) on the agent. The contracts are in [tools](../agent/tools.md), and the verbs have their own pages: [read](../agent/read.md) and [write](../agent/write.md). <!-- id:jCZEzRiL -->

**Running the automated tests.** The CLI and agent steps of every story run against a real daemon and the built web app. From `tests/`, run `SKIP_BUILD=true pnpm exec vitest --run user-stories`. Drop `SKIP_BUILD` for the first run, which builds the web app. The two automated app stories run against a packaged desktop app: from `frontend/apps/desktop`, run `pnpm package:e2e` once, then `pnpm e2e:stories`. The desktop suite uses its own account, appdata (`Seed-e2e`) and ports (58100 to 58106), so it never touches a dev or installed app. <!-- id:4wHdEdfA -->

**Names used below.** `<acct>` is an [account](../protocol/identity.md) id such as `z6Mk…`. `<library>` is the account that publishes this library, `z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb`. Every library schema lives at `hm://<library>/<name>`, where the name is its path in the library, so `hm://<library>/document` is the base document type. <!-- id:oztmKE3p -->

# 1. Understand the document model <!-- id:AMFjgZzp -->

**Goal.** Before typing anything, a person can see what a document is made of. That is its [metadata](../metadata.md) (name, summary, icon, the schema fields) and its content, a tree of [blocks](../protocol/blocks.md). They can follow the types all the way down to the [kinds](./kind.md) of value they are built from. <!-- id:_ikPLWpX -->

**In the app** <!-- id:nnKMNDW8 -->
  1. Open any document. The **Attributes** tab lists its metadata as editable fields. The **Content** tab is the block tree. <!-- id:6ySwBrba -->
  2. Open `hm://<library>/document`. The page explains the type in prose and shows its schema above the body: `metadata` and `content`, each a link. Follow `metadata` to [metadata](../metadata.md) for every built-in key, including `attributesSchema`, `childAttributesSchema` and `schemaDefinition`. Follow `content` to [block/node](../block/node.md) and on to the block types. <!-- id:0daJUHUr -->
  3. Every type name on those pages is a link, down to the nine kinds in [the data model](./data-model.md). **Inspect Schema** in a type page's menu opens the same schema by [CID](../protocol/blobs.md) at `/hm/schema/<cid>`, with its dependencies and dependents. <!-- id:jRqwN-xe -->

**With the CLI** <!-- id:fOPHu9gf -->
  1. `document get --md hm://<acct>/<path>` prints the document as markdown: the metadata as YAML frontmatter, and the blocks with their ids in trailing comments. <!-- id:ZTyY0oGQ -->
  2. `document get --json hm://<acct>/<path>` prints the document as the API returns it. `document get -m` prints the metadata only. <!-- id:2YhQdcMj -->
  3. `document get --md hm://<library>/document` reads the type page like any other. `schema get document` prints the schema it defines, and `schema get --resolve` prints the same schema with every reference followed and extensions merged. `blob get <cid>` reads any blob back as [dag-json](./dag-json.md). <!-- id:pZdlc6-t -->
  4. `document validate hm://<acct>/<path>` names the schema a document conforms to and how it got it (its own `attributesSchema`, or inherited from the parent's `childAttributesSchema`). If the document has none, it says so. <!-- id:EGiX5lnq -->

**Through an agent** <!-- id:rHb3ns_h -->
  1. `read hm://<acct>/<path>` returns the document as markdown with frontmatter, the same picture the CLI gives. <!-- id:qjfRlvIg -->
  2. `read hm://<library>/document` reads the type page. `read ipfs://<cid>` fetches a file into memory, and `read ipfs://<cid>` of a [DAG-CBOR](./dag-cbor.md) object decodes it (its value, signature check and schema check). A read of a typed document also returns a `schema` block: the type, how it was bound, and any missing required fields. <!-- id:Ez-m69u7 -->

**Status.** App: works. CLI: works. Agent: works. <!-- id:HcS5eyFR -->

# 2. Give a document custom metadata <!-- id:jnJM95xh -->

**Goal.** A person adds their own attributes to a document, such as `surname`, `status` and `born`. When the document should be a kind of thing, they say which type it conforms to, so the attributes are checked. <!-- id:C0bYP08p -->

**In the app** <!-- id:9NjDgrYx -->
  1. Open the document and switch to the **Attributes** tab. <!-- id:MzKMGOOq -->
  2. Press **Add field**. Enter the **Field name**, pick its **Type** (text, number, toggle, list, object, link…), and enter the value. Save or publish as with any edit. <!-- id:z1CMaGyt -->
  3. To type the document, add the field `attributesSchema` and set it to the type document's URL (`hm://<acct>/types/person`). The field is a document reference, so it offers a search and shows the target as a title pill. The type's required fields appear as fixed rows at once (story 4). <!-- id:h3tBTXeu -->

**With the CLI** <!-- id:RhZhfOGp -->
  1. `space export hm://<acct> ./site` writes every document to a markdown file whose frontmatter carries every metadata key. Add `surname: Smith` (and `attributesSchema: hm://<acct>/types/person`) to the file and run `space import hm://<acct> ./site --key <name>`. Only the changed document publishes. <!-- id:IvCAUrCj -->
  2. `document create -f page.md` keeps every frontmatter key: `surname: Smith` in the file becomes `surname` on the document. <!-- id:pNoTGuIK -->
  3. `document update hm://<acct>/<path> --metadata '{"surname":"Smith"}'` sets any attribute from the command line, and `--attributes-schema hm://<acct>/types/person` types the document. Both flags work on `create` too, and a flag wins over the file. <!-- id:DZ8eFUBI -->

**Through an agent** <!-- id:Oo3bqROi -->
  1. Call `write hm://<acct>/<path>` with `options: {action: "update", metadata: {surname: "Smith", attributesSchema: "hm://<acct>/types/person"}}`. `options.metadata` is merged into the document's metadata and accepts custom keys. `dryRun: true` echoes what would publish. <!-- id:nCAjOm-h -->

**Status.** App: works. CLI: works. Agent: works. <!-- id:liE5_ahF -->

# 3. Give the direct children of a document a type <!-- id:McbpSdEO -->

**Goal.** A person makes a folder typed. Every page created directly under it is a person, a place or an event, without setting `attributesSchema` on each one by hand. <!-- id:szM70YP0 -->

**In the app** <!-- id:iqobHnqn -->
  1. Open the folder document's **Attributes** tab. <!-- id:KK8Er4JX -->
  2. Add the field `childAttributesSchema` and point it at the type document (`hm://<acct>/types/person`). It uses the same search pill as `attributesSchema`. <!-- id:FC5f_ip4 -->
  3. Create a page under the folder. Its required attributes are already there as fixed rows, and its Attributes tab says which type it inherits. A child that sets its own `attributesSchema` uses that instead. See [typed documents](./typed-documents.md) for the inheritance rule. <!-- id:pHOiP3Yo -->

**With the CLI** <!-- id:9R7QXi7j -->
  1. Run `document update hm://<acct>/people --child-attributes-schema hm://<acct>/types/person`. Or put `childAttributesSchema: hm://<acct>/types/person` in the folder's frontmatter, then run `document create -f` or `space import`. <!-- id:cjn_V23c -->

**Through an agent** <!-- id:wlrYixCC -->
  1. Call `write hm://<acct>/people` with `options: {action: "update", metadata: {childAttributesSchema: "hm://<acct>/types/person"}}`. <!-- id:ZUGHwsZT -->

**Status.** App: works. CLI: works. Agent: works. <!-- id:FLDR8JJZ -->

# 4. See whether a document respects its schema <!-- id:yGb63zYD -->

**Goal.** Wherever a person edits a typed document, the editor tells them what the type requires and what is out of spec. It never stops them saving. <!-- id:7EPhbmDq -->

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

**Status.** App: works. CLI: works. Agent: works. <!-- id:zukntbIZ -->

# 5. Define a custom schema as a document <!-- id:J1U8mODk -->

**Goal.** A person publishes a type of their own, such as a Person or a Vote, as a document others can point at by URL. The document's metadata key `schemaDefinition` links the schema blob. <!-- id:rA2ukow4 -->

**In the app** <!-- id:IktlOkiJ -->
  1. Choose **New**, then **Schema** (with the Hypermedia Schemas switch on). A draft opens with an empty schema shown above the body. <!-- id:tXUATP1_ -->
  2. Give the document a name, and write a description in the body. The schema itself carries neither. The page carries them. <!-- id:RIVfC-ds -->
  3. Press **Edit** on the schema section. In the editor, use **Add field** for each [property](./property.md): its **Field name**, its type (picked from every type document, plus the built-ins: text, number, date, HM link, IPFS…), whether it is required, and a description. A union or a list is edited in the same form. **Schema JSON** switches to editing the schema as text. <!-- id:lq5g88L3 -->
  4. Publish. The working schema is frozen into a DAG-CBOR blob, and the document's `schemaDefinition` points at it. The page now shows a schema tag in its header and a **Create** button. <!-- id:JwxifnQe -->
  5. To build on an existing type, open its page and choose **Extend Schema**. The new draft starts as `{type: <that type>}` plus your fields, which is an [extension](./extension.md). A typed document schema extends `hm://<library>/document` and refines `metadata`. See [typed documents](./typed-documents.md). <!-- id:H3Lkwivi -->

**With the CLI** <!-- id:U6i9oiV8 -->
  1. Write the schema as dag-json next to the page: `types/person.md` and `types/person.schema.json`. `space import hm://<acct> ./site --key <name>` encodes the schema to its CID, publishes the blob, and binds it to the document as `schemaDefinition`. This library is published the same way. See [publish a folder](../build/publish-a-folder.md). <!-- id:PwwtiTUC -->
  2. `schema validate person.schema.json` checks the file against the [meta-schema](../schema.md) first. It also takes an `ipfs://` CID or a type document's URL. <!-- id:Eb_yjidc -->
  3. `document create -f person.md -p types/person --schema-definition person.schema.json` publishes the page and the schema blob together in one command, and binds them. `document update … --schema-definition` rebinds an existing page. <!-- id:gQHfxmM2 -->

**Through an agent** <!-- id:t6nL0N72 -->
  1. Call `write ipfs://` with the schema as JSON `content` and `options: {schema: "schema"}`. This validates it against the meta-schema, publishes the schema blob, and returns its CID. Then call `write hm://<acct>/types/person` with `options: {name: "Person", metadata: {schemaDefinition: "ipfs://<cid>"}}` to bind the blob to a type page. A `schemaDefinition` that is not a valid schema comes back as a `warning`. <!-- id:sC-PJ9DS -->

**Status.** App: works. CLI: works. Agent: works. <!-- id:aqx-CCxc -->

# 6. Create a blob that follows a custom schema exactly <!-- id:CEIhdkHd -->

**Goal.** With a type published, a person creates an object of that type. The object is a DAG-CBOR [blob](../protocol/blobs.md), not a document, and the editor holds it to the schema. <!-- id:ecJ7hNL_ -->

**In the app** <!-- id:Kb6T66AR -->
  1. Open the type document and press **Create** in its header (or **New Instance of this Schema** from the blob inspector). The value editor opens seeded with the schema's required fields. Each field has the control its type calls for, and the blob is validated on every keystroke. <!-- id:ljIK_hKn -->
  2. Press **Publish**. The blob is published with a `schema` link to the type, and its `ipfs://<cid>` is shown. The inspector opens it, names its type as a chip, and says whether it matches. <!-- id:Hv9qJfM6 -->
  3. You can also start from inside a document. In the **Attributes** tab, a field whose schema is an IPFS reference with a target type offers **Create linked object**. The dialog is locked to that type, publishes only a conforming value, and sets the field to the new `ipfs://<cid>`. **Edit linked object** publishes a new version and points the field at it. <!-- id:8uncXAIH -->
  4. Any blob can be opened by CID and checked. The inspector shows **Attach Schema…** to pick the type to validate against. <!-- id:aNeo_tnz -->

**With the CLI** <!-- id:WmADcfzx -->
  1. `blob validate -f bob.json --schema hm://<acct>/types/person` checks a dag-json value against the type. The schema can also be a file, an `ipfs://` CID, or a library name. <!-- id:Qt7DAgmz -->
  2. `blob create -f bob.json --schema hm://<acct>/types/person` validates the value and refuses on a violation unless you pass `--force`. It publishes the DAG-CBOR blob with a `schema` link to the type's blob and prints `ipfs://<cid>`. `-q` prints only the URL, and `--dry-run` shows the blob and its CID without publishing. <!-- id:pJlKco1A -->
  3. `blob get <cid>` reads it back as dag-json. `blob verify <cid>` checks it against the linked schema. <!-- id:55ppIvSG -->

**Through an agent** <!-- id:NsYtZVP5 -->
  1. Call `write ipfs://` with the object as JSON `content` and `options: {schema: "hm://<acct>/types/person"}`. This validates it against the type, refuses on a violation (unless `options.force` is set), publishes the DAG-CBOR blob with a `schema` link, and returns its CID. `read ipfs://<cid>` reads it back with its schema check. <!-- id:ZUDskmfL -->

**Status.** App: works. CLI: works. Agent: works. <!-- id:PfFtaN9e -->

# 7. Extend the signed blob envelope into a new signed type <!-- id:6Vb6S0VT -->

**Goal.** A person defines a new kind of signed record, such as a Vote or an Attestation. It carries `signer`, `sig` and `ts` like every built-in blob, plus its own fields and its own `type` tag. <!-- id:hGYD00FY -->

**In the app** <!-- id:Pf8uuizb -->
  1. Choose **New**, then **Schema**. In the editor, set the schema's root type to **Signed blob** ([blob](../blob.md), found with the type search) and enter the **Type tag** (for example `Vote`). The schema becomes an extension of the [envelope](./envelope.md) with `type` pinned to the literal `"Vote"`. The envelope fields are inherited and shown as inherited. <!-- id:fRYgz98q -->
  2. Add the type's own fields (`target` as an HM link, `choice` as a union of literals). Publish. The page carries the schema and is now a signed type: its **Create** button reads **Sign & publish** (story 8). <!-- id:mwAGRQPu -->
  3. Or open the blob page and choose **Extend Schema** to start from the envelope directly. <!-- id:B4BhWu7g -->

**With the CLI** <!-- id:jdh8RNzv -->
  1. Write a schema whose root is `{"type": "hm://<library>/blob", "properties": {"type": {"value": "Vote", "required": true}, …}}`. Publish it as a type page with `document create --schema-definition vote.schema.json`, or beside its page with `space import`, as in story 5. <!-- id:SsUIQT9- -->

**Through an agent** <!-- id:2OweK2rk -->
  1. Do the same as story 5, with a schema whose root is `{"type": "hm://<library>/blob", "properties": {"type": {"value": "Vote", "required": true}, …}}`. `write ipfs://` with `options: {schema: "schema"}` publishes the signed type's schema blob. Then a `write hm://…/types/vote` with `metadata.schemaDefinition` binds it. <!-- id:21O_MRe- -->

**Status.** App: works. CLI: works. Agent: works. <!-- id:wJjSs4ZM -->

# 8. Create an instance of the signed type and sign it <!-- id:O6AYVjZw -->

**Goal.** A person fills in a Vote and signs it with the account they are using. The result is a real signed blob on the network that anyone can verify. <!-- id:ld5_5873 -->

**In the app** <!-- id:tF4tqUf- -->
  1. Open the Vote type page and press **Sign & publish**. The form shows only the type's own fields. The envelope is filled at signing. <!-- id:I2W-ztNt -->
  2. Fill the fields. Choose the account to sign with. On desktop this is the selected account, and the button explains when the app cannot sign for one. <!-- id:pavvXjx1 -->
  3. Press **Sign & publish**. The blob is encoded as [canonical](./canonical-encoding.md) CBOR with `sig` zeroed, signed by the account's key, and published with the [signature](../signature.md) in place. This is the daemon's own signing rule. **Inspect the signed blob** opens it: `signer` is the account, `sig` is the signature, and the type chip names Vote. <!-- id:PCbauCtD -->

**With the CLI** <!-- id:1r5ox2Ps -->
  1. `blob sign -f vote.json --schema hm://<acct>/types/vote --key <name>` takes the type's own fields and adds the envelope: `type` from the schema's pinned tag, `signer` set to the key's [principal](../principal.md), `ts` set to now, and `sig`. It signs the canonical DAG-CBOR with `sig` zeroed (the daemon's own rule, shared with the app), validates the whole signed blob against the type, publishes, and prints `ipfs://<cid>`. `--dry-run` shows the signed blob without publishing. `--type <tag>` signs an arbitrary blob with the envelope when there is no schema. <!-- id:KTpAo7M7 -->
  2. `blob verify <cid>` checks the signature (who signed, and when) and the schema, and exits with code 1 when either fails. `--json` reports both. <!-- id:J9vu1et6 -->

**Through an agent** <!-- id:guAYQDxx -->
  1. Call `write ipfs://` with the fields as JSON `content` and `options: {schema: "hm://<acct>/types/vote", sign: true}`. This wraps the fields in the signed blob envelope, signs with the agent's identity (`options.signer` picks one when several are enabled), validates, and publishes. `read ipfs://<cid>` returns the decoded value, the `signature` (signer, time, and whether it is valid), and the schema check. <!-- id:EoL9rIyL -->

**Status.** App: works. CLI: works. Agent: works. <!-- id:G3ib1FbL -->

# Where each surface stands <!-- id:dZwbHVf8 -->

All three surfaces now cover all eight stories. The resolver, validator and signing rule live in `@seed-hypermedia/client` (`schema-engine`, `schema-resolve`, `signed-blob`). The app, the CLI and the agents service share that code, so the three agree about what a schema means. See the [SDK](../build/sdk.md). <!-- id:YzHMO1GS -->

The CLI and agent columns are fully automated. Every CLI and agent step above runs in `tests/user-stories.integration.test.ts`, against a real daemon and the web app. The agent steps run through `agents/scripts/user-stories.ts`, which calls the same `read` and `write` verbs a person uses from the agent UI. The app column automates stories 1 and 2 in `frontend/apps/desktop/tests/user-stories/`. The rest of the app column is tested by hand with the steps above. An isolated test daemon cannot browse the public library, and the desktop unit tests already cover the schema and blob editors. <!-- id:P7-KXoKT -->

# See also <!-- id:WvQ9u3os -->

- [Typed documents](./typed-documents.md): the model behind stories 2 to 5. <!-- id:Iu1HdDPV -->
- [Hypermedia Schemas in one page](./quick-reference.md): the model, the commands and the agent verbs on one page. <!-- id:nr9YU-al -->
- [The World Builder](./world-builder.md): a worked demo of typed documents in the app. <!-- id:DqFcZuXR -->
- [Schema language](./schema-language.md): the vocabulary every schema here is written in. <!-- id:XVvSRiPR -->
- [Network blobs](./blobs.md): the envelope and the built-in signed blob types. <!-- id:G0ynL-ym -->
- [CLI](../build/cli.md): the full command reference. <!-- id:DJbzyR0z -->
- [Seed Agents](../agent.md): the runtime behind the `read` and `write` tools. <!-- id:bI7pY-Nh -->
