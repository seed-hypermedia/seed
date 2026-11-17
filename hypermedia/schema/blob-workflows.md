---
name: Typed Blob Workflows
summary: This page gives numbered steps to create an object of a type, define a signed blob type and sign an instance of it, in the Seed app, with the CLI and through an agent.
---
This page shows how to work with typed [blobs](../protocol/blobs.md). A blob is one stored piece of data, named by the hash of its bytes. A typed blob is a blob that follows a [schema](../schema.md), which is a description of what the data must look like. There are three tasks: create a raw object that follows a schema, define a signed blob type of your own, and sign and publish an instance of it.

Each task has steps for the [Seed app](../software/desktop.md), the CLI and an [agent](../agent.md). [Schema workflows](./workflows.md) covers the setup of each surface, the names used here (`<acct>`, the inspector, the Schema view), and the tasks for [documents](../protocol/documents.md) and types. [Typing a blob](./typing-a-blob.md) explains the model.

# Create an object of a type <!-- id:CEIhdkHd -->

When a type is published, you can create an object of that type. The object is a [DAG-CBOR](./dag-cbor.md) blob, not a document. The editor checks it against the schema as you type. [Typing a blob](./typing-a-blob.md) explains the `schema` link the object carries.

**In the app** <!-- id:Kb6T66AR -->
  1. Open the type document and choose **New Raw Value** in its options menu. The blob editor opens with the schema's required fields already there. Each field has the control its type calls for, and the editor checks the blob on every keystroke. <!-- id:ljIK_hKn -->
  2. Fill the fields.
  3. Press **Publish**. The app publishes the blob with a `schema` link to the type and shows its `ipfs://<cid>`. The inspector opens the blob, names its type as a chip, and says whether it matches. <!-- id:Hv9qJfM6 -->

Other ways to reach the same editor:
  - On a schema blob in the inspector, choose **New Instance of this Schema** in the options menu.
  - On the web, and for a signed blob type, the page header has a **Create** button that opens a form for the type.
  - Inside a document, open the **Attributes** tab. A field whose schema is an IPFS reference has a **Create linked object** button (the curly braces). When the field has a target type, the dialog is locked to that type and publishes only a value that matches it. Press **Publish & link** to set the field to the new `ipfs://<cid>`. **Edit linked object** publishes a new version and points the field at it. <!-- id:8uncXAIH -->

To check a blob that exists:
  1. Open the blob by its [CID](../cid.md) in the inspector. When the blob links a schema, the inspector fetches the schema and checks the value against it. The result is a warning only. <!-- id:aNeo_tnz -->
  2. To check against another type, choose **Attach Schema…** and pick the type.
  3. Edit the blob as fields, or choose **View raw** to edit it as [dag-json](./dag-json.md).

**New Blob** in the inspector's options menu starts a blank DAG-CBOR object with no schema.

**With the CLI** <!-- id:WmADcfzx -->
  1. `blob validate -f bob.json --schema hm://<acct>/types/person` checks a dag-json value against the type. The schema can also be a file, an `ipfs://` CID, or a library name. <!-- id:Qt7DAgmz -->
  2. `blob create -f bob.json --schema hm://<acct>/types/person` checks the value and refuses it on a violation, unless you pass `--force`. Then it publishes the DAG-CBOR blob with a `schema` link to the type's blob and prints `ipfs://<cid>`. `-q` prints only the URL. `--dry-run` shows the blob and its CID without publishing. <!-- id:pJlKco1A -->
  3. `blob get <cid>` reads it back as dag-json. `blob verify <cid>` checks it against the linked schema, and says that it is not a signed blob. <!-- id:55ppIvSG -->

**Through an agent** <!-- id:NsYtZVP5 -->
  1. Call `write ipfs://` with the object as JSON `content` and `options: {schema: "hm://<acct>/types/person"}`. The agent checks it against the type and refuses it on a violation, unless `options.force` is set. Then it publishes the DAG-CBOR blob with a `schema` link and returns its CID.
  2. `read ipfs://<cid>` reads it back with its schema check. <!-- id:ZUDskmfL -->

# Define a signed blob type <!-- id:6Vb6S0VT -->

You can define a new kind of signed record, such as a Vote or an Attestation. It carries `signer`, `sig` and `ts` like every built-in blob. It adds its own fields and its own `type` tag. The shared fields are called the envelope, and [Network blobs](./blobs.md) explains it.

**In the app** <!-- id:Pf8uuizb -->
  1. Choose **New**, then **Schema**. This needs the Hypermedia Schemas switch ([schema workflows](./workflows.md) says where it is).
  2. Press **Edit** on the schema section. In the editor, search the root type for [Blob](../blob.md), the signed blob envelope, and pick it.
  3. Enter the **Type tag**, for example `Vote`. The schema is then an [extension](./extension.md) of the envelope with `type` pinned to the [literal](./literal-schema.md) `"Vote"`. The envelope fields show as inherited. <!-- id:fRYgz98q -->
  4. Add the type's own fields, for example `target` as an HM link and `choice` as a union of literals. <!-- id:mwAGRQPu -->
  5. Publish. The page carries the schema and is a signed type: its **Create** button opens the signing form.

You can also start from the envelope. Open the [Blob](../blob.md) page and choose **Extend Schema** in its options menu. <!-- id:B4BhWu7g -->

**With the CLI** <!-- id:jdh8RNzv -->
  1. Write a schema file, `vote.schema.json`, whose root is `{"type": "hm://hyper.media/blob", "properties": {"type": {"value": "Vote", "required": true}, …}}`.
  2. Publish it as a type page with `document create -f vote.md -p types/vote --schema-definition vote.schema.json`. Or put it beside its page and run `space import hm://<acct> -d ./site --key <name>`. Both are in [define a type and publish it](./workflows.md#J1U8mODk). <!-- id:SsUIQT9- -->

**Through an agent** <!-- id:2OweK2rk -->
  1. Call `write ipfs://` with `options: {schema: "schema"}` and, as `content`, a schema whose root is `{"type": "hm://hyper.media/blob", "properties": {"type": {"value": "Vote", "required": true}, …}}`. This publishes the schema blob of the signed type and returns its CID.
  2. Call `write hm://<acct>/types/vote` with `options: {metadata: {schemaDefinition: "ipfs://<cid>"}}`. This binds the blob to a type page. <!-- id:21O_MRe- -->

# Sign and publish an instance of a signed type <!-- id:O6AYVjZw -->

You fill in a Vote and sign it with the [account](../protocol/identity.md) you are using. The result is a signed blob on the network, and anyone can check its signature.

**In the app** <!-- id:tF4tqUf- -->
  1. Open the Vote type page and press **Create**. The form shows only the type's own fields. The envelope is filled in at signing. <!-- id:I2W-ztNt -->
  2. Fill the fields. The app signs with the selected account. The button explains when the app cannot sign for that account. <!-- id:pavvXjx1 -->
  3. Press **Sign & publish**. The app encodes the blob as [canonical](./canonical-encoding.md) CBOR with `sig` set to zeros, signs it with the account's key, and publishes it with the [signature](../signature.md) in place. This is the same signing rule the [daemon](../software/daemon.md) uses.
  4. Press **Inspect the signed blob** to open it. `signer` is the account, `sig` is the signature, and the type chip names Vote. <!-- id:PCbauCtD -->

**With the CLI** <!-- id:1r5ox2Ps -->
  1. Run `blob sign -f vote.json --schema hm://<acct>/types/vote --key <name>`. The file holds the type's own fields. The command adds the envelope: `type` from the schema's pinned tag, `signer` set to the key's [principal](../principal.md), `ts` set to the current time, and `sig`. It signs the canonical DAG-CBOR with `sig` set to zeros, which is the daemon's rule and the app's rule too. Then it checks the whole signed blob against the type, publishes it, and prints `ipfs://<cid>`. `--dry-run` shows the signed blob without publishing. With no schema, `--type <tag>` signs any blob with the envelope. <!-- id:KTpAo7M7 -->
  2. Run `blob verify <cid>`. It checks the signature (who signed, and when) and the schema. The exit code is 1 when either check fails. `--json` reports both. <!-- id:J9vu1et6 -->

**Through an agent** <!-- id:guAYQDxx -->
  1. Call `write ipfs://` with the fields as JSON `content` and `options: {schema: "hm://<acct>/types/vote", sign: true}`. The agent wraps the fields in the signed blob envelope and signs with its own identity. `options.signer` picks an identity when several are enabled. Then it checks the blob and publishes it.
  2. `read ipfs://<cid>` returns the decoded value, the `signature` (signer, time, and whether it is valid), and the schema check. <!-- id:EoL9rIyL -->

# See also

- [Schema workflows](./workflows.md): setup, [typed documents](./typed-documents.md), and how to define and publish a type.
- [Typing a blob](./typing-a-blob.md): the `schema` link on a raw object, with a worked example.
- [Network blobs](./blobs.md): the signed envelope and the built-in signed blob types.
- [Blob](../blob.md): the envelope's fields and the signing rule.
- [CLI](../build/cli.md): the `blob` and `schema` commands.
- [write](../agent/write.md): the agent verb that publishes blobs.
