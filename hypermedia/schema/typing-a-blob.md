---
name: Typing a Blob
summary: A raw DAG-CBOR object can name the schema that describes it in a top-level schema field, and this page shows how the tools check it, with a Person and Employee example.
---
A raw object can say which [schema](../schema.md) describes it. It does this with one extra field at the top, named **`schema`**, that links to the schema. For example, an object `{"schema": <link>, "name": "Bob"}` says "check me against that schema".

A raw object here is a [DAG-CBOR](./dag-cbor.md) [blob](../protocol/blobs.md): a piece of data stored by the hash of its bytes, its [CID](../cid.md). The schema and the object are two separate blobs, each with its own CID. Neither needs a Hypermedia [document](../protocol/documents.md). The `schema` field is optional. It is a convention of the Seed blob tools. It is not a keyword of DAG-CBOR or of the [schema language](./schema-language.md). <!-- id:rawSchemaMeaning -->

The published link is a CID. In [dag-json](./dag-json.md) you write it as `"schema": {"/": "<schema-cid>"}`. The `/` [envelope](./envelope.md) is how dag-json writes a real [link](../link.md). Put the bare CID inside it, without `ipfs://`. The shared resolver also accepts a string that names a schema, such as `"schema": "ipfs://<schema-cid>"` or an `hm://` schema URL. The [CLI](../build/cli.md) and the write tool of [Seed Agents](../agent.md) add a CID link for you when you give them a schema whose CID is known. <!-- id:rawSchemaSpelling -->

To check a typed blob, the tools do four things:

1. Read the blob's `schema` reference.
2. Load that schema and the schemas it depends on.
3. Take the top-level `schema` field out of the value to check.
4. Check the fields that remain.

The stored blob keeps the link. You do not add `schema` to the schema's `properties`, and a closed [struct](../struct.md) does not count it as an unexpected field. In the [SDK](../build/sdk.md) these steps are `blobSchemaRef`, `loadSchemaRef`, `withoutSchemaLink` and `validate`. If you call the low-level validator yourself, it does not remove the link for you. <!-- id:rawSchemaValidation -->

Only a map can carry this field. You can still check a scalar or a list against a schema that you give separately, for example with the CLI's `--schema` option. An object can also leave the link out when you give its schema separately. The link states a type. It does not prove that the data matches. <!-- id:rawSchemaOptional -->

# Person and Employee as raw data <!-- id:rawPersonEmployee -->

Publish the four objects below in order. Replace each CID placeholder with the CID you get back when you publish its schema. The built-in `hm://hyper.media/…` types come from the library bundled in the SDK, so you do not need to create documents for them. <!-- id:rawExampleSetup -->

**1. Person schema.** Save this as `person.schema.json` and publish it to get `<person-schema-cid>`. A schema does not need a `schema` link of its own. The tools check it against the [meta-schema](../schema.md), which they already know. <!-- id:rawPersonSchema -->

```json <!-- id:rawPersonJson -->
{
  "type": "hm://hyper.media/struct",
  "properties": {
    "name": {
      "value": {"type": "hm://hyper.media/string"},
      "required": true
    },
    "age": {
      "value": {"type": "hm://hyper.media/integer"}
    }
  }
}
```

**2. Employee schema.** Save this as `employee.schema.json` and publish it to get `<employee-schema-cid>`. Its `type` names the Person schema [directly by `ipfs://` URL](./references.md#directSchemaCid). Its properties [extend](./extension.md) Person, so both `name` and `employeeId` are required. <!-- id:rawEmployeeSchema -->

```json <!-- id:rawEmployeeJson -->
{
  "type": "ipfs://<person-schema-cid>",
  "properties": {
    "employeeId": {
      "value": {"type": "hm://hyper.media/string"},
      "required": true
    },
    "department": {
      "value": {"type": "hm://hyper.media/string"}
    }
  }
}
```

**3. An employee.** Save this as `alice.json`. Its `schema` link points at Employee, and the Employee schema refers to Person. <!-- id:rawEmployeeInstance -->

```json <!-- id:rawAliceJson -->
{
  "schema": {"/": "<employee-schema-cid>"},
  "name": "Alice",
  "age": 32,
  "employeeId": "E-001",
  "department": "Engineering"
}
```

**4. A person.** Save this as `bob.json`. Person requires `name`, and `age` is optional. <!-- id:rawPersonInstance -->

```json <!-- id:rawBobJson -->
{
  "schema": {"/": "<person-schema-cid>"},
  "name": "Bob",
  "age": 28
}
```

Publish the files with the CLI, in these steps:

1. Publish `person.schema.json`. `--schema schema` checks it against the bundled meta-schema, and `--no-link` stores its content exactly as shown above.
2. Put the Person CID you got back into `employee.schema.json`, then publish it the same way.
3. Put both schema CIDs into `alice.json` and `bob.json`, then publish them. <!-- id:rawPublishInstructions -->

```sh <!-- id:rawPublishCommands -->
seed-cli blob create -f person.schema.json --schema schema --no-link
seed-cli blob create -f employee.schema.json --schema schema --no-link
seed-cli blob create -f alice.json
seed-cli blob create -f bob.json
```

The last two commands read the `schema` link of each object and check the object before they publish it. `seed-cli blob validate -f alice.json` runs the same check and publishes nothing. <!-- id:rawPublishValidation -->

# `schema`, `type` and document bindings <!-- id:rawSchemaDistinction -->

These three are easy to mix up:

- In a schema, `type` names the kind or the parent schema that the schema refines.
- On a raw object, `schema` links to the schema that describes the object.
- A data field named `type`, such as `"type": "Change"` on a signed blob, is an ordinary field. The blob's schema constrains it. It does not replace the `schema` link. <!-- id:rawTypeDistinction -->

[Typed documents](./typed-documents.md) add a binding one level up. `attributesSchema` types a document's metadata, and `schemaDefinition` makes a document the named home of a schema blob. The four raw objects above need neither field. <!-- id:rawDocumentDistinction -->

# See also

- [Typed blob workflows](./blob-workflows.md): the steps in the [Seed app](../software/desktop.md), the CLI and through an agent.
- [Typed documents](./typed-documents.md): the same idea for a document's attributes.
- [References and naming](./references.md): referencing a schema by CID or by name.
- [Encoding](./encoding.md): DAG-CBOR, dag-json and the `/` form of a link.
- [Network blobs](./blobs.md): signed blobs, which carry a `type` tag of their own.
- [SDK](../build/sdk.md): `schema-engine` and `schema-resolve`.
