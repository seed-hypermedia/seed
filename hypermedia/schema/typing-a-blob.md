---
name: Typing a Blob
summary: How a raw DAG-CBOR object links to the schema that describes it with a top-level schema field, how the tools validate it, and a worked example with Person and Employee.
---
A raw [DAG-CBOR](./dag-cbor.md) object can carry an optional top-level **`schema`** field that links to the [schema](../schema.md) describing its data. The schema and the instance are separate DAG-CBOR blobs, each with its own CID. Neither needs a Hypermedia document. This field is a convention of the Seed blob tools, not a keyword of DAG-CBOR or of the [schema language](./schema-language.md). <!-- id:rawSchemaMeaning -->

The published link is a CID, written in dag-json as `"schema": {"/": "<schema-cid>"}`. The `/` [envelope](./envelope.md) represents a native [link](../link.md). Put the bare CID inside it, without `ipfs://`. The shared resolver also accepts a schema-reference string, such as `"schema": "ipfs://<schema-cid>"` or an `hm://` schema URL. The CLI and agent write tools add a CID link by default when given a schema with a known CID. <!-- id:rawSchemaSpelling -->

To validate a typed blob, the tools read its `schema` reference, load that schema and its dependencies, remove the top-level `schema` field from the value being checked, and validate the remaining fields. The stored blob keeps the link. You do not add `schema` to the schema's `properties`, and it does not count as an unexpected field in a closed struct. In the SDK these steps use `blobSchemaRef`, `loadSchemaRef`, `withoutSchemaLink` and `validate`. Calling the low-level validator directly does not remove the link for you. <!-- id:rawSchemaValidation -->

Only a map can carry this field. A scalar or list can still be validated against a schema supplied separately, for example with the CLI's `--schema` option. An object may also omit the link when its schema is supplied separately. The link declares a type; it is not proof that the data conforms. <!-- id:rawSchemaOptional -->

# Person and Employee as raw data <!-- id:rawPersonEmployee -->

Publish the following four objects in order. Replace each CID placeholder with the CID returned when its schema is published. The built-in `hm://hyper.media/…` types resolve from the SDK's bundled library, so you do not need to create documents for them. <!-- id:rawExampleSetup -->

**1. Person schema.** Save this as `person.schema.json` and publish it to obtain `<person-schema-cid>`. Schemas do not need a `schema` link of their own to be recognized; they are checked against the known [meta-schema](../schema.md). <!-- id:rawPersonSchema -->

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

**2. Employee schema.** Save this as `employee.schema.json` and publish it to obtain `<employee-schema-cid>`. Its `type` references the Person schema [directly by `ipfs://` URL](./references.md#directSchemaCid). Its properties [extend](./extension.md) Person, so both `name` and `employeeId` are required. <!-- id:rawEmployeeSchema -->

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

**3. An employee.** Save this as `alice.json`. Its `schema` link points to Employee, whose schema in turn refers to Person. <!-- id:rawEmployeeInstance -->

```json <!-- id:rawAliceJson -->
{
  "schema": {"/": "<employee-schema-cid>"},
  "name": "Alice",
  "age": 32,
  "employeeId": "E-001",
  "department": "Engineering"
}
```

**4. A person.** Save this as `bob.json`. Person requires `name`; `age` is optional. <!-- id:rawPersonInstance -->

```json <!-- id:rawBobJson -->
{
  "schema": {"/": "<person-schema-cid>"},
  "name": "Bob",
  "age": 28
}
```

With the [CLI](../build/cli.md), publish the schema files against the bundled meta-schema. `--no-link` keeps their stored contents exactly as shown above. Substitute the returned Person CID in `employee.schema.json` before publishing it, then substitute both schema CIDs in the instance files. <!-- id:rawPublishInstructions -->

```sh <!-- id:rawPublishCommands -->
seed-cli blob create -f person.schema.json --schema schema --no-link
seed-cli blob create -f employee.schema.json --schema schema --no-link
seed-cli blob create -f alice.json
seed-cli blob create -f bob.json
```

The last two commands read each instance's own `schema` link and validate before publishing. `seed-cli blob validate -f alice.json` performs the same schema check without publishing. <!-- id:rawPublishValidation -->

# `schema`, `type` and document bindings <!-- id:rawSchemaDistinction -->

In a schema definition, `type` names the kind or parent schema being refined. On a raw instance, `schema` links to the schema that describes the instance. A data field named `type`, such as `"type": "Change"` on a signed blob, is an ordinary field constrained by that blob's schema; it does not replace the `schema` link. <!-- id:rawTypeDistinction -->

[Typed documents](./typed-documents.md) add a higher-level binding: `attributesSchema` types a document's metadata, and `schemaDefinition` makes a document the named home of a schema blob. Those document fields are not needed for the four raw objects above. <!-- id:rawDocumentDistinction -->

# See also

- [Typed blob workflows](./blob-workflows.md): the steps in the Seed app, the CLI and through an agent.
- [Typed documents](./typed-documents.md): the same idea for a document's attributes.
- [References and naming](./references.md): referencing a schema by CID or by name.
- [Encoding](./encoding.md): DAG-CBOR, dag-json and the `/` spelling of a link.
- [Network blobs](./blobs.md): signed blobs, which carry a `type` tag of their own.
- [SDK](../build/sdk.md): `schema-engine` and `schema-resolve`.
