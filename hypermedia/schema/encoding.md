---
name: Encoding
summary: How raw objects link to their schemas with the schema field, how DAG-CBOR and dag-json encode them, and how publishing computes their CIDs.
---
# Encoding: DAG-CBOR and the dag-json human form <!-- id:f2uoHc9L -->

Hypermedia values, both schemas and the data they type, are [DAG-CBOR](./dag-cbor.md) blocks on IPFS. DAG-CBOR is a restricted, deterministic profile of binary CBOR with built-in support for links ([CIDs](../protocol/blobs.md)). It is the canonical wire form. The same encoding carries the network's signed [blobs](../protocol/blobs.md). <!-- id:xr_d_48R -->

People cannot edit DAG-CBOR directly, so this repo writes everything in [dag-json](./dag-json.md), the JSON projection of the same [data model](./data-model.md). A person can read and diff dag-json, and tools convert it to and from DAG-CBOR with no loss that matters here. <!-- id:hGuzUAVh -->

``` <!-- id:grYnFGUo -->
   dag-json  (this repo, human form)  <——>  DAG-CBOR  (IPFS, canonical form)
   JSON text, hm:// name refs                binary, hm:// name refs, CID links
```

## The reserved-key envelopes <!-- id:j0GQ_2TD -->

JSON has no native way to write bytes or a link. dag-json borrows map syntax with **one reserved key, `/`**. These are the [envelopes](./envelope.md): <!-- id:YpcMmEMS -->

<!-- id:gZfcUpHN -->
| kind <!-- col:Lf10HYeS --> | dag-json <!-- col:M8I8Wqkg --> | DAG-CBOR <!-- col:7vTETkPd --> <!-- id:Je27na7i --> |
| --- | --- | --- |
| link | `{"/":"bafy…"}` | CID (tag 42) <!-- id:WXOoojol --> |
| bytes | `{"/":{"bytes":"aGVsbG8"}}` | byte string (major type 2), base64 in JSON <!-- id:FtMcyizZ --> |

**These are not maps.** They are the JSON spelling of two separate [kinds](./kind.md). In DAG-CBOR there is no ambiguity: a link is a tagged CID and bytes are a byte string. In dag-json they look like maps. This causes dag-json's one trap: a real data map with a single `/` key cannot be told apart from a link. <!-- id:Bq6LLLsU -->

The schema language's rule avoids the trap (see [the data model](./data-model.md)). Links and bytes are **atomic kinds**, and a schema never describes them as maps. A schema says `{"type":"link"}` and never reaches inside the envelope. The reference validator, `validate.mjs`, enforces this. Its `typeOf` recognizes the two envelopes and reports `link` or `bytes`, so a value typed `map` rejects a `{"/":…}` shape, and the reverse also holds. <!-- id:2x73pir3 -->

## The `schema` field on raw objects <!-- id:rawSchemaLink -->

A raw object can carry an optional top-level **`schema`** field that links to the schema describing its data. The schema and the instance are separate DAG-CBOR blobs, each with its own CID. Neither needs a Hypermedia document. This field is a convention of the Seed blob tools, not a keyword of DAG-CBOR or of the [schema language](./schema-language.md). <!-- id:rawSchemaMeaning -->

The published link is a CID, written in dag-json as `"schema": {"/": "<schema-cid>"}`. The `/` envelope represents a native link, as explained above; put the bare CID inside it, without `ipfs://`. The shared resolver also accepts a schema-reference string, such as `"schema": "ipfs://<schema-cid>"` or an `hm://` schema URL. The CLI and agent write tools add a CID link by default when given a schema with a known CID. <!-- id:rawSchemaSpelling -->

To validate a typed blob, the tools read its `schema` reference, load that schema and its dependencies, remove the top-level `schema` field from the value being checked, and validate the remaining fields. The stored blob keeps the link. You do not add `schema` to the schema's `properties`, and it does not count as an unexpected field in a closed struct. In the SDK these steps use `blobSchemaRef`, `loadSchemaRef`, `withoutSchemaLink` and `validate`. Calling the low-level validator directly does not remove the link for you. <!-- id:rawSchemaValidation -->

Only a map can carry this field. A scalar or list can still be validated against a schema supplied separately, for example with the CLI's `--schema` option. An object may also omit the link when its schema is supplied separately. The link declares a type; it is not proof that the data conforms. <!-- id:rawSchemaOptional -->

### Person and Employee as raw data <!-- id:rawPersonEmployee -->

Publish the following four objects in order. Replace each CID placeholder with the CID returned when its schema is published. The built-in `hm://hyper.media/…` types resolve from the SDK's bundled library; you do not need to create documents for them. <!-- id:rawExampleSetup -->

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

**2. Employee schema.** Save this as `employee.schema.json` and publish it to obtain `<employee-schema-cid>`. Its `type` references the Person schema directly by `ipfs://` URL. Its properties [extend](./extension.md) Person, so both `name` and `employeeId` are required. <!-- id:rawEmployeeSchema -->

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

### `schema`, `type` and document bindings <!-- id:rawSchemaDistinction -->

In a schema definition, `type` names the kind or parent schema being refined. On a raw instance, `schema` links to the schema that describes the instance. A data field named `type`, such as `"type": "Change"` on a signed blob, is an ordinary field constrained by that blob's schema; it does not replace the `schema` link. <!-- id:rawTypeDistinction -->

[Typed documents](./typed-documents.md) add a higher-level binding: `attributesSchema` types a document's metadata, and `schemaDefinition` makes a document the named home of a schema blob. Those document fields are not needed for the four raw objects above. <!-- id:rawDocumentDistinction -->

## Canonical encoding <!-- id:_xPmfmd5 -->

CIDs are content hashes, so **the same value must always encode to the same bytes**. Otherwise its CID would change. DAG-CBOR requires a [canonical encoding](./canonical-encoding.md): <!-- id:E8QsaeNL -->
  - map keys sorted by a defined ordering, <!-- id:l6YAoUHJ -->
  - shortest-form integer encodings, <!-- id:MJGGUCHC -->
  - no floating-point NaN/Infinity, <!-- id:D1qqS-Rb -->
  - exactly one way to encode any value. <!-- id:ADsShIXd -->

For authors, **key order and formatting in these JSON files do not matter.** Whitespace and the order of `properties` do not change the resulting block or its CID, because the encoder normalizes them. Two schemas that differ only in key order are the same block with the same CID. <!-- id:1XV1UcRp -->

## The publish step <!-- id:xI7XePTO -->

Two scripts turn this repo into published Hypermedia types. `node scripts/hypermedia/publish.mjs` computes the CIDs, and `pnpm hypermedia:push` publishes the blobs: <!-- id:ilHK6ydh -->
  1. `publish.mjs` parses each `.schema.json` file as dag-json. References are already **`hm://` URLs**, which are names. The step does not rewrite them into CIDs, so recursive and mutually recursive schemas keep working (see [references](./references.md)). <!-- id:3NjmpKsi -->
  2. It encodes each schema to canonical DAG-CBOR and content-addresses it as a CIDv1 with sha2-256 and the `dag-cbor` codec (0x71). The backend uses the same codec for its blobs. <!-- id:aqTbhvIL -->
  3. It writes `schemas.lock.json`, the manifest that maps each `hm://` URL to its CID. `publish.mjs` publishes nothing. `pnpm hypermedia:push` encodes each schema file again, checks its CID against `schemas.lock.json`, and stops on any mismatch. Then it publishes every schema blob to the server and imports each page as a document in the space of the signing key at its path, with `hm://hyper.media` in links and frontmatter swapped for that key, with the schema blob as the page's `schemaDefinition`. <!-- id:hVW1Ddfl -->

Canonical DAG-CBOR is deterministic, so **the CID is a pure function of a schema's content**. CI and any runtime that recomputes it get the same CID. This has two consequences: <!-- id:m9tDS9Ms -->
  - `node publish.mjs --check` runs in CI. It fails if the lockfile is stale, and a CID that changes in a diff means the schema changed. <!-- id:wtUc5Kgv -->
  - A schema links others by **name**, so its CID depends only on its own bytes. Editing `block` does **not** change the CID of `change`. In a CID or Merkle graph, any change would propagate upward. The manifest is the separate name-to-CID index a resolver uses. <!-- id:UfL2JB8v -->

Anyone can resolve a schema by its `hm://` name, through the manifest or the SDK's bundle. The network does not resolve the `hyper.media` [authority](../authority.md) yet, so a fetch over the network uses the docs space's key. They can also fetch an exact version by CID, decode the DAG-CBOR, and type-check data against it. That is the same validation this repo runs locally. <!-- id:53nL6eHG -->

# See also <!-- id:f3T2QJJS -->

- [References and naming](./references.md): why references are names and not CIDs. <!-- id:a5VF35ot -->
- [The data model](./data-model.md): the nine kinds, including link and bytes. <!-- id:-R8AO22o -->
- [DAG-CBOR](./dag-cbor.md), [dag-json](./dag-json.md), [Envelope](./envelope.md) and [Canonical encoding](./canonical-encoding.md): the term pages. <!-- id:-lKkBjIt -->
- [Blobs](../protocol/blobs.md): how the network encodes and signs its data. <!-- id:bMA7jKeP -->
- [CID](../cid.md): the CID type. <!-- id:IxZuGZOV -->
- [Schemas for network blobs](./blobs.md): the blob schemas built on this encoding. <!-- id:ylJUSWo0 -->
