---
name: Typed Blob Workflows
summary: How to create an object of a type, define a signed blob type and sign an instance of it, each with its steps in the Seed app, the CLI and through an agent.
---
This page gives the steps for working with typed [blobs](../protocol/blobs.md): create a raw object that follows a [schema](../schema.md), define a signed blob type of your own, and sign and publish an instance of it. Each workflow has steps for the Seed app, the CLI and an agent. [Schema workflows](./workflows.md) covers the setup of each surface, the names used here, and the workflows for documents and types. [Typing a blob](./typing-a-blob.md) explains the model.

# Create an object of a type <!-- id:CEIhdkHd -->

With a type published, you create an object of that type. The object is a DAG-CBOR [blob](../protocol/blobs.md), not a document, and the editor holds it to the schema. [Typing a blob](./typing-a-blob.md) explains the `schema` link the object carries.

**In the app** <!-- id:Kb6T66AR -->
  1. Open the type document and press **Create** in its header. **New Raw Value** in the page's options menu and **New Instance of this Schema** on a schema blob in the inspector open the same editor. It is seeded with the schema's required fields. Each field has the control its type calls for, and the blob is validated on every keystroke. <!-- id:ljIK_hKn -->
  2. Press **Publish**. The blob is published with a `schema` link to the type, and its `ipfs://<cid>` is shown. The inspector opens it, names its type as a chip, and says whether it matches. <!-- id:Hv9qJfM6 -->
  3. You can also start from inside a document. In the **Attributes** tab, a field whose schema is an IPFS reference with a target type offers **Create linked object**. The dialog is locked to that type, publishes only a conforming value, and sets the field to the new `ipfs://<cid>`. **Edit linked object** publishes a new version and points the field at it. <!-- id:8uncXAIH -->
  4. Any blob can be opened by CID in the inspector and checked. **Attach Schema…** picks the type to validate against. When a blob links a schema, the inspector fetches the schema and checks the value against it, as a warning only. You can edit the blob as fields or as raw dag-json. **New Blob** in the inspector's options menu starts a blank DAG-CBOR object. <!-- id:aNeo_tnz -->

**With the CLI** <!-- id:WmADcfzx -->
  1. `blob validate -f bob.json --schema hm://<acct>/types/person` checks a dag-json value against the type. The schema can also be a file, an `ipfs://` CID, or a library name. <!-- id:Qt7DAgmz -->
  2. `blob create -f bob.json --schema hm://<acct>/types/person` validates the value and refuses on a violation unless you pass `--force`. It publishes the DAG-CBOR blob with a `schema` link to the type's blob and prints `ipfs://<cid>`. `-q` prints only the URL, and `--dry-run` shows the blob and its CID without publishing. <!-- id:pJlKco1A -->
  3. `blob get <cid>` reads it back as dag-json. `blob verify <cid>` checks it against the linked schema. <!-- id:55ppIvSG -->

**Through an agent** <!-- id:NsYtZVP5 -->
  1. Call `write ipfs://` with the object as JSON `content` and `options: {schema: "hm://<acct>/types/person"}`. This validates it against the type, refuses on a violation (unless `options.force` is set), publishes the DAG-CBOR blob with a `schema` link, and returns its CID. `read ipfs://<cid>` reads it back with its schema check. <!-- id:ZUDskmfL -->

# Define a signed blob type <!-- id:6Vb6S0VT -->

You define a new kind of signed record, such as a Vote or an Attestation. It carries `signer`, `sig` and `ts` like every built-in blob, plus its own fields and its own `type` tag. [Network blobs](./blobs.md) explains the signed envelope.

**In the app** <!-- id:Pf8uuizb -->
  1. Choose **New**, then **Schema**. In the editor, set the schema's root type to **Signed blob** ([blob](../blob.md), found with the type search) and enter the **Type tag** (for example `Vote`). The schema becomes an extension of the [signed blob envelope](../blob.md) with `type` pinned to the literal `"Vote"`. The envelope fields are inherited and shown as inherited. <!-- id:fRYgz98q -->
  2. Add the type's own fields (`target` as an HM link, `choice` as a union of literals). Publish. The page carries the schema and is a signed type: its **Create** button reads **Sign & publish**. <!-- id:mwAGRQPu -->
  3. Or open the blob page and choose **Extend Schema** to start from the envelope directly. <!-- id:B4BhWu7g -->

**With the CLI** <!-- id:jdh8RNzv -->
  1. Write a schema whose root is `{"type": "hm://hyper.media/blob", "properties": {"type": {"value": "Vote", "required": true}, …}}`. Publish it as a type page with `document create --schema-definition vote.schema.json`, or beside its page with `space import`, as in [define a type and publish it](./workflows.md#J1U8mODk). <!-- id:SsUIQT9- -->

**Through an agent** <!-- id:2OweK2rk -->
  1. Publish a schema whose root is `{"type": "hm://hyper.media/blob", "properties": {"type": {"value": "Vote", "required": true}, …}}`. `write ipfs://` with `options: {schema: "schema"}` publishes the signed type's schema blob. Then a `write hm://…/types/vote` with `metadata.schemaDefinition` binds it. <!-- id:21O_MRe- -->

# Sign and publish an instance of a signed type <!-- id:O6AYVjZw -->

You fill in a Vote and sign it with the account you are using. The result is a signed blob on the network that anyone can verify.

**In the app** <!-- id:tF4tqUf- -->
  1. Open the Vote type page and press **Sign & publish**. The form shows only the type's own fields. The envelope is filled at signing. <!-- id:I2W-ztNt -->
  2. Fill the fields. Choose the account to sign with. On desktop this is the selected account, and the button explains when the app cannot sign for one. <!-- id:pavvXjx1 -->
  3. Press **Sign & publish**. The blob is encoded as [canonical](./canonical-encoding.md) CBOR with `sig` zeroed, signed by the account's key, and published with the [signature](../signature.md) in place. This is the daemon's own signing rule. **Inspect the signed blob** opens it: `signer` is the account, `sig` is the signature, and the type chip names Vote. <!-- id:PCbauCtD -->

**With the CLI** <!-- id:1r5ox2Ps -->
  1. `blob sign -f vote.json --schema hm://<acct>/types/vote --key <name>` takes the type's own fields and adds the envelope: `type` from the schema's pinned tag, `signer` set to the key's [principal](../principal.md), `ts` set to the current time, and `sig`. It signs the canonical DAG-CBOR with `sig` zeroed (the daemon's own rule, shared with the app), validates the whole signed blob against the type, publishes, and prints `ipfs://<cid>`. `--dry-run` shows the signed blob without publishing. `--type <tag>` signs an arbitrary blob with the envelope when there is no schema. <!-- id:KTpAo7M7 -->
  2. `blob verify <cid>` checks the signature (who signed, and when) and the schema, and exits with code 1 when either fails. `--json` reports both. <!-- id:J9vu1et6 -->

**Through an agent** <!-- id:guAYQDxx -->
  1. Call `write ipfs://` with the fields as JSON `content` and `options: {schema: "hm://<acct>/types/vote", sign: true}`. This wraps the fields in the signed blob envelope, signs with the agent's identity (`options.signer` picks one when several are enabled), validates, and publishes. `read ipfs://<cid>` returns the decoded value, the `signature` (signer, time, and whether it is valid), and the schema check. <!-- id:EoL9rIyL -->

# See also

- [Schema workflows](./workflows.md): setup, typed documents, and how to define and publish a type.
- [Typing a blob](./typing-a-blob.md): the `schema` link on a raw object, with a worked example.
- [Network blobs](./blobs.md): the signed envelope and the built-in signed blob types.
- [Blob](../blob.md): the envelope's fields and the signing rule.
- [CLI](../build/cli.md): the `blob` and `schema` commands.
- [write](../agent/write.md): the agent verb that publishes blobs.
