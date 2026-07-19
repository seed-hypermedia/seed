# The schema dialect: "Seed Blob Schema v1"

A subset of **JSON Schema 2020-12**, extended with the two IPLD DAG-CBOR kinds JSON
lacks — **links** and **bytes** — and stored as ordinary DAG-CBOR blobs. This doc is
the normative reference for what a schema can say and what it means.

Design inputs: IPLD Schemas (we borrow its *kind* vocabulary, not its DSL), AT
Protocol Lexicon (precedent for `bytes`/`cid-link` types over DAG-CBOR — but it
extends the closed `type` set, which breaks standard validators; we don't), Ceramic
TileDocuments (schemas at immutable content-addressed IDs), and VSCode/SchemaStore
(`$schema` pointer + warn-don't-block UX).

## Storage & identity

- A schema is a **DAG-CBOR blob**, published exactly like any other blob
  (`dagJsonToIpld → dag-cbor encode → sha2-256 → CIDv1(0x71) → PublishBlobs`).
- **Identity is the CID.** Schemas carry no `$id` — a content-addressed blob cannot
  contain its own CID. The base URI of a schema is its retrieval URI `ipfs://<cid>`
  (explicitly permitted by the 2020-12 spec).
- Schemas are **immutable**. "Editing" a schema publishes a new CID. Instances keep
  pointing at the exact schema version they were authored against; re-pointing an
  instance at a newer schema is an explicit user action (which itself mints a new
  instance CID).

## One attachment convention: the `schema` field

An instance blob declares its schema with a reserved top-level key:

```json
{ "schema": { "/": "<schemaCid>" }, ...rest of the data }
```

The value is a **native IPLD link** (CBOR tag 42 on the wire, DAG-JSON `{"/": cid}`
form in the editor). It rides through publish, undo, copy/paste, and JSON mode with
zero special machinery because it's just data.

**Schemas are instances too.** A schema blob is simply a blob whose `schema` field
links to the well-known **meta-schema** (the schema of schemas). There is no separate
`$schema` keyword in this dialect — one convention covers blob→schema and
schema→meta-schema alike, and "the schema editor" is the blob editor with the
meta-schema attached.

Detection: a blob *is a schema* iff `isDagJsonLink(value.schema)` and the link target
is the meta-schema CID. Blobs with a `schema` key that isn't such a link are plain
data — the key is never hidden or stripped (a user might legitimately own that name;
we only *treat* it as an attachment when it's a link).

### Bootstrap: the meta-schema

The meta-schema cannot link to itself (it can't contain its own CID). It is the one
exception: the app ships the meta-schema value **and its precomputed CID** as
constants (`BLOB_META_SCHEMA`, `BLOB_META_SCHEMA_CID`), recognizes it by CID, and
publishes it to the local node whenever a schema is published, so the link always
resolves. Dialect versioning = publishing a new meta-schema blob with a new CID.

## Supported keywords (v1)

Unknown keywords are **silently ignored** (annotation semantics, per 2020-12). The
validator is advisory-only — see [architecture](./architecture.md#gentle-validation).

| Keyword | Applies to | Notes |
| --- | --- | --- |
| `type` | any | Single string: `null`, `boolean`, `integer`, `number`, `string`, `array`, `object`. DAG-CBOR distinguishes int/float encodings, so `integer`/`number` map onto the editor's existing whole/float inputs. No type arrays in v1. |
| `kind` | any | **Our extension**: `"link"` or `"bytes"` — mutually exclusive with `type`. See below. |
| `title`, `description` | any | UI labels/help. |
| `default` | any | Used by "new instance" to materialize fields. |
| `enum`, `const` | leaves | Enum renders a select when the current value conforms; a non-member value stays free text + warning (never coerced). |
| `properties` | object | Map of property name → subschema. |
| `required` | object | Missing required keys warn; the editor offers one-click "add" chips. |
| `additionalProperties` | object | Boolean only. `false` warns on unknown keys (still editable). |
| `items` | array | Single subschema for all items. |
| `minItems`, `maxItems` | array | |
| `minimum`, `maximum` | number/integer | Inclusive. |
| `minLength`, `maxLength`, `pattern` | string | `pattern` is an ECMA regex, unanchored per spec. |
| `$defs` | schema root (or any level) | Named subschemas for internal reuse. |
| `$ref` | any | See ref semantics below. |
| `targetSchema` | `kind: "link"` | IPLD link to the schema the *linked blob* is expected to conform to (analogue of IPLD's `&Type`). Hint-only in v1: drives UI ("create linked blob from this schema", label the link) — not deep-validated. |
| `maxBytes` | `kind: "bytes"` | Size cap, warns only. |

**Explicitly deferred** (mostly RJSF-documented pain points): `oneOf`/`anyOf`/`allOf`/
`not`, `if`/`then`/`else`, type arrays, `patternProperties`, `dependent*`, `format`,
`prefixItems`, `unevaluated*`, `exclusiveMinimum`/`Maximum`, `uniqueItems`.

## IPLD kinds: `kind: "link"` and `kind: "bytes"`

Why a sibling keyword instead of extending `type`: `type` is a **closed set** in JSON
Schema — `"type": "link"` makes the schema *invalid* to every standard validator
(Lexicon's interop problem). An unknown sibling keyword degrades gracefully to an
annotation.

Validation operates on the **DAG-JSON forms** the editor holds in memory, using the
existing predicates (`isDagJsonLink`, `isDagJsonBytes` in `packages/ui/src/dag-json.ts`):

- `kind: "link"` matches `{"/": "<cid>"}` (a real CID string).
- `kind: "bytes"` matches `{"/": {"bytes": "<base64>"}}`.

For export to vanilla JSON Schema, `kind: "link"` can be losslessly expanded to the
literal structural form (`{"type":"object","required":["/"],...}`) — but stored
schemas keep only `kind`: minimal, intent-preserving, and the literal form is
inherently ambiguous with real single-`"/"`-key maps (a DAG-JSON spec-level
reservation). Corollary: a schema must not declare a property named `"/"`; the schema
editor forbids it.

## `$ref` semantics under content addressing

Two ref forms, deliberately distinct:

- **Internal**: `"$ref": "#/$defs/Name"` — a standard JSON-pointer string within the
  same schema blob. Cycles are legal (recursive types); resolvers and renderers carry
  a cycle guard (visited-set / lazy expansion).
- **External**: `"$ref": {"/": "<cid>"}` — a **real IPLD link** to another whole
  schema blob (no cross-blob fragments in v1). In stored DAG-CBOR this is a tag-42
  link, so schema→schema edges are solid, traversable, pinnable DAG edges.
  Cross-blob cycles are impossible by construction: an immutable Merkle DAG can't
  point forward.

Non-string `$ref` deviates from JSON Schema core (which wants a URI string); the
export converter maps `{"/": cid} ⇄ "ipfs://cid"` losslessly for interop with
standard tooling.

External refs are resolved by the app **before** validation: a hook walks the schema,
collects link refs, fetches each via the existing `/ipfs/{cid}.dagjson` path
(immutable → cached forever), and hands the validator a plain
`Record<cid, schema>` registry. Validation itself stays synchronous and pure. An
unresolved ref means "schema unknown here" — a neutral loading state, never a warning
against the data.

## Examples

A schema (shown in its DAG-JSON face; `schema` links the meta-schema):

```json
{
  "schema": { "/": "<metaSchemaCid>" },
  "title": "Article",
  "type": "object",
  "required": ["title", "body"],
  "properties": {
    "title":  { "type": "string", "minLength": 1, "maxLength": 200 },
    "body":   { "kind": "link", "title": "Body document",
                "targetSchema": { "/": "<bodySchemaCid>" } },
    "cover":  { "kind": "bytes", "title": "Cover image", "maxBytes": 1048576 },
    "tags":   { "type": "array", "items": { "type": "string" } },
    "status": { "type": "string", "enum": ["draft", "published"], "default": "draft" },
    "author": { "$ref": "#/$defs/Person" },
    "reviewer": { "$ref": { "/": "<personSchemaCid>" } }
  },
  "additionalProperties": true,
  "$defs": {
    "Person": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name":   { "type": "string" },
        "avatar": { "kind": "bytes" }
      }
    }
  }
}
```

An instance of it:

```json
{
  "schema": { "/": "<articleSchemaCid>" },
  "title": "Hello",
  "body": { "/": "<bodyCid>" },
  "status": "draft",
  "tags": ["intro"],
  "author": { "name": "Eric" }
}
```

## Numeric & encoding cautions

- DAG-CBOR ints beyond `Number.MAX_SAFE_INTEGER` can surface as imprecise numbers
  through the DAG-JSON path; the validator tolerates this and never rewrites numbers.
- `1` vs `1.0` in schema keywords (`minimum` etc.) affects the CBOR encoding and thus
  the schema's CID — canonical key ordering is already handled
  (`dagCborKeyCompare`), but authors should know a float-typed bound produces a
  different CID than an int-typed one.
