---
name: "User stories: typed documents and blobs"
summary: What a person should be able to do with schemas through the Seed app, the CLI, and an agent — the precise steps for each story, and where each surface stands today.
---
These are the things a person should be able to do with the type system, stated as stories. Each story says what the person wants, then the exact steps on each of the three surfaces: the **Seed app** (desktop and web), the **CLI** (`seed-cli`, run from source with `bun run src/index.ts` in `frontend/apps/cli`, or `npx -y @seed-hypermedia/cli`), and an **agent** (the `read` and `write` tools of [Seed Agents](./agents.md)). Every story ends with where each surface stands: **works**, **partial**, or **missing** — and the missing pieces are collected into the backlog at the end. The model underneath is explained in [typed documents](./typed-documents.md); the vocabulary in [the schema language](./schema-language.md). <!-- id:0uMy7lU9 -->

# Before you start <!-- id:aNQZP66c -->

**The app.** On desktop the schema features sit behind a switch: Settings → Developers → **Enable Debug Tools**, then **Hypermedia Schemas**. With it on, the **New** menu gains **Schema**, and a document's options menu gains **New Blob**, **New Schema**, and **New World…**. On the web the same features are on by default. Validation is advisory everywhere: a value that breaks its schema is marked in red, never refused. See [why Onyx](./why.md). <!-- id:5iiI8U-W -->

**The CLI.** Point it at the node you are working with and sign with a key it holds: `--server http://localhost:58004` for the desktop dev app's API, `--server https://hyper.media` (the default) for the public gateway, and `--key <name>` for the signing key (`key list` shows them). `--dev` selects the development keyring. The command reference is [CLI](./cli.md). <!-- id:l0yc6wyb -->

**An agent.** An agent reads hypermedia with `read <address>` and publishes with `write <address>`; publishing needs the **publish** grant on the agent. The contracts are in [tools](./agent-tools.md). <!-- id:jCZEzRiL -->

**Names used below.** `<acct>` is an account id such as `z6Mk…`; `<onyx>` is the account that publishes this library, `z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb`, so `hm://<onyx>/hypermedia-document` is the base document type. <!-- id:oztmKE3p -->

# 1. Understand the document model <!-- id:AMFjgZzp -->

**Goal.** Before typing anything, a person can see what a document is made of: its metadata (name, summary, icon, the schema fields) and its content, a tree of blocks — and can follow the types all the way down to the kinds of value they are built from. <!-- id:_ikPLWpX -->

**In the app** <!-- id:nnKMNDW8 -->
  1. Open any document. The **Attributes** tab lists its metadata as editable fields; the **Content** tab is the block tree. <!-- id:6ySwBrba -->
  2. Open `hm://<onyx>/hypermedia-document`. The page explains the type in prose and shows its schema above the body: `metadata` and `content`, each a link. Follow `metadata` to [hypermedia-metadata](./hypermedia-metadata.md) for every built-in key including `schema`, `childrenSchema` and `schemaDefinition`; follow `content` to [hypermedia-block-node](./hypermedia-block-node.md) and on to the block types. <!-- id:0daJUHUr -->
  3. Every type name on those pages is a link, down to the nine kinds in [the data model](./data-model.md). **Inspect Schema** in a type page's menu opens the same schema by CID at `/hm/schema/<cid>`, with dependencies and dependents. <!-- id:jRqwN-xe -->

**With the CLI** <!-- id:fOPHu9gf -->
  1. `document get --md --frontmatter hm://<acct>/<path>` prints the document as markdown: the metadata as YAML frontmatter, the blocks with their ids in trailing comments. <!-- id:ZTyY0oGQ -->
  2. `document get --json hm://<acct>/<path>` prints the document as the API returns it; `document get -m` prints the metadata only. <!-- id:2YhQdcMj -->
  3. `document get --md hm://<onyx>/hypermedia-document` reads the type page like any other; `document cid <cid>` fetches the raw schema blob it defines. <!-- id:pZdlc6-t -->

**Through an agent** <!-- id:rHb3ns_h -->
  1. `read hm://<acct>/<path>` returns the document as markdown with frontmatter — the same picture the CLI gives. <!-- id:qjfRlvIg -->
  2. `read hm://<onyx>/hypermedia-document` reads the type page; `read ipfs://<cid>` fetches a blob into memory. <!-- id:Ez-m69u7 -->

**Status.** App: works. CLI: works for reading; nothing shows the _schema_ a document conforms to (see story 4). Agent: works for reading; the agent has no notion of a document's schema yet. <!-- id:HcS5eyFR -->

# 2. Give a document custom metadata <!-- id:jnJM95xh -->

**Goal.** A person adds their own attributes to a document — `surname`, `status`, `born` — and, when the document should be a _kind_ of thing, says which type it conforms to so the attributes are checked. <!-- id:C0bYP08p -->

**In the app** <!-- id:9NjDgrYx -->
  1. Open the document and switch to the **Attributes** tab. <!-- id:MzKMGOOq -->
  2. Press **Add field**. Enter the **Field name**, pick its **Type** (text, number, toggle, list, object, link…), enter the value. Save or publish as with any edit. <!-- id:z1CMaGyt -->
  3. To type the document, add the field `schema` and set it to the type document's URL (`hm://<acct>/types/person`) — the field is a document reference, so it offers a search and shows the target as a title pill. The type's required fields appear as fixed rows immediately (story 4). <!-- id:h3tBTXeu -->

**With the CLI** <!-- id:RhZhfOGp -->
  1. `space export hm://<acct> ./site` writes every document to a markdown file whose frontmatter carries every metadata key; add `surname: Smith` (and `schema: hm://<acct>/types/person`) to the file and run `space import hm://<acct> ./site --key <name>`. Only the changed document publishes. <!-- id:IvCAUrCj -->
  2. `document create` and `document update` publish only the built-in keys they have flags for (`--name`, `--summary`, `--icon`, …); a custom key in the file's frontmatter is dropped on the way in. <!-- id:pNoTGuIK -->

**Through an agent** <!-- id:Oo3bqROi -->
  1. `write hm://<acct>/<path>` with `options: {action: "update", metadata: {surname: "Smith", schema: "hm://<acct>/types/person"}}`. `options.metadata` is merged into the document's metadata and accepts custom keys; `dryRun: true` echoes what would publish. <!-- id:nCAjOm-h -->

**Status.** App: works. CLI: partial — works through `space import`, missing from `document create` / `document update` (needs a way to set arbitrary metadata, e.g. `--metadata '<json>'` or frontmatter passthrough). Agent: works. <!-- id:liE5_ahF -->

# 3. Give the direct children of a document a type <!-- id:McbpSdEO -->

**Goal.** A person makes a folder typed: every page created directly under it is a person, a place, an event — without setting `schema` on each one by hand. <!-- id:szM70YP0 -->

**In the app** <!-- id:iqobHnqn -->
  1. Open the folder document's **Attributes** tab. <!-- id:KK8Er4JX -->
  2. Add the field `childrenSchema` and point it at the type document (`hm://<acct>/types/person`), the same search pill as `schema`. <!-- id:FC5f_ip4 -->
  3. Create a page under the folder: its required attributes are already there as fixed rows, and its Attributes tab says which type it inherits. A child that sets its own `schema` uses that instead. See [typed documents](./typed-documents.md) for the inheritance rule. <!-- id:pHOiP3Yo -->

**With the CLI** <!-- id:9R7QXi7j -->
  1. As in story 2: `childrenSchema: hm://<acct>/types/person` in the folder's frontmatter, then `space import`. <!-- id:cjn_V23c -->

**Through an agent** <!-- id:wlrYixCC -->
  1. `write hm://<acct>/people` with `options: {action: "update", metadata: {childrenSchema: "hm://<acct>/types/person"}}`. <!-- id:ZUGHwsZT -->

**Status.** App: works. CLI: partial, same gap as story 2. Agent: works for setting the field; when the agent then creates a child it gets no hint of the required fields (story 4). <!-- id:FLDR8JJZ -->

# 4. See whether a document respects its schema <!-- id:yGb63zYD -->

**Goal.** Wherever a person edits a typed document, the editor tells them what the type requires and what is out of spec — and never stops them saving. <!-- id:7EPhbmDq -->

**In the app** <!-- id:tcvWFOIf -->
  1. Open a typed document (its own `schema`, or inherited from the parent's `childrenSchema`). The type's required fields are always-visible rows at the top of the **Attributes** tab and above the body in the **Content** tab; they cannot be removed. <!-- id:zEs9xjkx -->
  2. A field gets the control its type calls for: a dropdown for a union of literals, a date picker for a date, a searchable title pill for a document reference, a file picker for an IPFS reference. <!-- id:eVZIyat1 -->
  3. A value that breaks the schema shows a red badge on the field naming the rule ("surname is required", "status must be one of draft, published, archived"). Saving still works. <!-- id:5K-lLqtH -->
  4. The Attributes tab suggests the schema's optional fields as chips; pressing one adds it with a conforming starting value. <!-- id:FfbnAjlb -->

**With the CLI** <!-- id:RzEbdruT -->
  1. Nothing yet. The intended shape: `document validate hm://<acct>/<path>` resolves the document's effective schema (its `schema`, else the parent's `childrenSchema`) and prints each violation, exit code 1 when there are any; `space import --check` runs the same over a folder before publishing. <!-- id:yLJ2_4AB -->

**Through an agent** <!-- id:XFxKCawf -->
  1. Nothing yet. The intended shape: a `write` to a typed document returns the violations as `warnings` beside the published id (still advisory), and a `read` of a typed document says which schema it conforms to and which required fields are missing. <!-- id:U9EmE1SJ -->

**Status.** App: works. CLI: missing. Agent: missing. <!-- id:zukntbIZ -->

# 5. Define a custom schema as a document <!-- id:J1U8mODk -->

**Goal.** A person publishes a type of their own — a Person, a Vote — as a document others can point at by URL, whose metadata `schemaDefinition` links the schema blob. <!-- id:rA2ukow4 -->

**In the app** <!-- id:IktlOkiJ -->
  1. **New → Schema** (with the Hypermedia Schemas switch on). A draft opens with an empty schema shown above the body. <!-- id:tXUATP1_ -->
  2. Give the document a name and a description in the body — the schema itself carries neither; the page does. <!-- id:RIVfC-ds -->
  3. Press **Edit** on the schema section. In the editor, **Add field** for each property: its **Field name**, its type (picked from every type document, plus the built-ins — text, number, date, HM link, IPFS…), whether it is required, a description. A union or a list is edited in the same form; **Schema JSON** switches to editing the schema as text. <!-- id:lq5g88L3 -->
  4. Publish. The working schema is frozen into a DAG-CBOR blob, and the document's `schemaDefinition` points at it. The page now shows a schema tag in its header and a **Create** button. <!-- id:JwxifnQe -->
  5. To build on an existing type instead, open its page and choose **Extend Schema**: the new draft starts as `{ref: <that type>}` plus your fields. A typed _document_ schema extends `hm://<onyx>/hypermedia-document` and refines `metadata` — see [typed documents](./typed-documents.md). <!-- id:H3Lkwivi -->

**With the CLI** <!-- id:U6i9oiV8 -->
  1. Write the schema as dag-json next to the page: `types/person.md` and `types/person.schema.json`. `space import hm://<acct> ./site --key <name>` encodes the schema to its CID, publishes the blob, and binds it to the document as `schemaDefinition`. This is how this library itself is published — see [Repo HM sync](./repo-hm-sync.md). <!-- id:PwwtiTUC -->
  2. The check `node hypermedia/validate.mjs <schema.json>` validates a schema file against the meta-schema before publishing (in this repository; not yet part of the CLI). <!-- id:Eb_yjidc -->
  3. A one-off `document create --schema-definition person.schema.json` does not exist yet. <!-- id:gQHfxmM2 -->

**Through an agent** <!-- id:t6nL0N72 -->
  1. Nothing yet. An agent can write the page, but cannot publish a DAG-CBOR blob or bind one: `write ipfs://` publishes files (UnixFS), not objects, and `options.metadata.schemaDefinition` only helps once a blob exists. <!-- id:sC-PJ9DS -->

**Status.** App: works. CLI: partial — works through `space import`, missing as a single command. Agent: missing. <!-- id:aqx-CCxc -->

# 6. Create a blob that follows a custom schema exactly <!-- id:CEIhdkHd -->

**Goal.** With a type published, a person creates an object of it — not a document, a DAG-CBOR blob — and the editor holds them to the schema. <!-- id:ecJ7hNL_ -->

**In the app** <!-- id:Kb6T66AR -->
  1. Open the type document and press **Create** in its header (or **New Instance of this Schema** from the blob inspector). The value editor opens seeded with the schema's required fields; each field has the control its type calls for, and the blob is validated on every keystroke. <!-- id:ljIK_hKn -->
  2. Press **Publish**. The blob is published with a `schema` link to the type, and its `ipfs://<cid>` is shown. The inspector opens it, names its type as a chip, and says whether it matches. <!-- id:Hv9qJfM6 -->
  3. From inside a document instead: in the **Attributes** tab, a field whose schema is an IPFS reference with a target type offers **Create linked object**; the dialog is locked to that type, publishes only a conforming value, and sets the field to the new `ipfs://<cid>`. **Edit linked object** publishes a new version and re-points the field. <!-- id:8uncXAIH -->
  4. Any blob can be opened by CID and checked: the inspector shows **Attach Schema…** to pick the type to validate against. <!-- id:aNeo_tnz -->

**With the CLI** <!-- id:WmADcfzx -->
  1. Nothing yet. The intended shape: `blob create --schema hm://<acct>/types/person -f bob.json --key <name>` validates `bob.json` (dag-json) against the resolved schema, refuses on violation unless `--force`, publishes the DAG-CBOR blob with its `schema` link, and prints `ipfs://<cid>`; `blob validate --schema <url> -f bob.json` checks without publishing; `document cid <cid>` already reads one back. <!-- id:kTz1dZki -->

**Through an agent** <!-- id:NsYtZVP5 -->
  1. Nothing yet. The intended shape: `write ipfs://` with `content` as JSON and `options: {schema: "hm://<acct>/types/person"}` publishes a validated object and returns its CID. <!-- id:ZUDskmfL -->

**Status.** App: works. CLI: missing. Agent: missing. <!-- id:PfFtaN9e -->

# 7. Extend the signed blob envelope into a new signed type <!-- id:6Vb6S0VT -->

**Goal.** A person defines a new kind of signed record — a Vote, an Attestation — that carries `signer`, `sig` and `ts` like every built-in blob, plus its own fields and its own `type` tag. <!-- id:hGYD00FY -->

**In the app** <!-- id:Pf8uuizb -->
  1. **New → Schema**, then in the editor set the schema's root type to **Signed blob** ([hypermedia-blob](./hypermedia-blob.md), found with the type search) and enter the **Type tag** (e.g. `Vote`). The schema becomes an extension of the envelope with `type` pinned to the literal `"Vote"`; the envelope fields are inherited and shown as such. <!-- id:fRYgz98q -->
  2. Add the type's own fields (`target` as an HM link, `choice` as a union of literals). Publish. The page carries the schema and is now a signed type: its **Create** button reads **Sign & publish** (story 8). <!-- id:mwAGRQPu -->
  3. Or open the hypermedia-blob page and choose **Extend Schema** to start from the envelope directly. <!-- id:B4BhWu7g -->

**With the CLI** <!-- id:jdh8RNzv -->
  1. A `.schema.json` beside a page whose root is `{"ref": "hm://<onyx>/hypermedia-blob", "properties": {"type": {"value": "Vote", "required": true}, …}}`, published with `space import` as in story 5. <!-- id:SsUIQT9- -->

**Through an agent** <!-- id:2OweK2rk -->
  1. Nothing yet (same gap as story 5). <!-- id:21O_MRe- -->

**Status.** App: works. CLI: partial, via `space import`. Agent: missing. <!-- id:wJjSs4ZM -->

# 8. Create an instance of the signed type and sign it <!-- id:O6AYVjZw -->

**Goal.** A person fills in a Vote and signs it with the account they are using; the result is a real signed blob on the network, verifiable by anyone. <!-- id:ld5_5873 -->

**In the app** <!-- id:tF4tqUf- -->
  1. Open the Vote type page and press **Sign & publish**. The form shows only the type's own fields; the envelope is filled at signing. <!-- id:I2W-ztNt -->
  2. Fill the fields. Choose the account to sign with (desktop: the selected account; the button explains when the app cannot sign for one). <!-- id:pavvXjx1 -->
  3. Press **Sign & publish**. The blob is encoded as canonical CBOR with `sig` zeroed, signed by the account's key, and published with the signature in place — the daemon's own rule. **Inspect the signed blob** opens it: `signer` is the account, `sig` is the signature, and the type chip names Vote. <!-- id:PCbauCtD -->

**With the CLI** <!-- id:1r5ox2Ps -->
  1. Nothing yet. The intended shape: `blob sign --schema hm://<acct>/types/vote -f vote.json --key <name>` validates the fields, fills `signer`/`ts`, signs canonical CBOR with `sig` zeroed (the same client rule the app uses), publishes, and prints `ipfs://<cid>`; `blob verify <cid>` checks the signature and the schema. <!-- id:JLre_NlF -->

**Through an agent** <!-- id:guAYQDxx -->
  1. Nothing yet. The intended shape: `write ipfs://` with `options: {schema: "hm://<acct>/types/vote", sign: true}` (and `options.signer` to pick the identity) — the agent already selects signing identities for hypermedia writes, so the same choice applies. <!-- id:EoL9rIyL -->

**Status.** App: works. CLI: missing. Agent: missing. <!-- id:G3ib1FbL -->

# Backlog <!-- id:dZwbHVf8 -->

What the stories leave missing, in the order to build it: <!-- id:YzHMO1GS -->
  1. **CLI: arbitrary metadata on `document create` / `document update`** — pass custom keys through from frontmatter and add `--metadata '<json>'`; this alone completes stories 2 and 3 on the CLI. <!-- id:8Qz9NvML -->
  2. **CLI: `document validate`** and **`space import --check`** — resolve the effective schema and print violations (story 4). <!-- id:kjY_ZNgi -->
  3. **CLI: `blob create` / `blob validate`** — publish a DAG-CBOR object that follows a schema (story 6), and `document create --schema-definition <file>` for a one-off type (story 5). <!-- id:Dbf7xFr8 -->
  4. **CLI: `blob sign` / `blob verify`** — the signed-blob rule as a command (story 8). <!-- id:AyzzZOBB -->
  5. **Agent: schema-aware reads and writes** — `read` reports a typed document's schema and missing fields; `write` returns violations as warnings (story 4). <!-- id:COc7v5L7 -->
  6. **Agent: `write ipfs://` for objects** — JSON content with `options.schema`, and `options.sign` for signed types (stories 5–8). <!-- id:aBcySoNd -->

Each of these is a thin layer over what exists: the resolver, validator and signing rule live in `@seed-hypermedia/client` and the Onyx engine, and the CLI and the agents service already share the command envelope. <!-- id:81B1gfjU -->
