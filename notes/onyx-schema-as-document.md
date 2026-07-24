# Schemas as Hypermedia documents (URL-ified schemas)

**Decision (2026-07-14):** Url-ify all schema references toward Onyx by making a **schema a
Hypermedia document**. A schema lives at an `hm://` URL; the document's **metadata declares
"this document describes a schema" and carries the schema definition**. Everything that
references a schema — an instance's attachment, a `$ref` to another schema, a schema-typed
metadata field — uses that **`hm://` URL** (a name), never a bare CID.

This is Onyx's "names on the wire" applied through the HM document model, and it dogfoods the
network: schemas *are* documents (browsable, versioned, addressable, recursive).

## Why (what's wrong today)

The v1 "Seed Blob Schema" is a raw DAG-CBOR blob addressed by **CID**, with CID links for
`schema`/`$ref`/`targetSchema` and JSON-Schema vocabulary (`type:"object"`). Example — the
`Person` schema at `dev.hyper.media/…/bafyreibdz…`:

```jsonc
{ "type": "object", "title": "Person",
  "schema": { "/": "bafyrei…metaCID" },      // CID link — should be an hm:// URL
  "required": ["Name"],
  "properties": { "Name": { "type": "string" }, "Birthdate": { "type": "string" } } }
```

CIDs aren't human, aren't recursive, and churn on every edit. Onyx uses `hm://` names instead.

## Model  (convention finalized 2026-07-14)

- A **schema document** is a normal HM document at `hm://<space>/<path>` (e.g.
  `hm://<account>/schemas/person`).
- Its **metadata carries a reserved key `schemaDefinition` = `ipfs://<cid>`** — a *reference* to the
  schema blob (an immutable DAG-CBOR blob the schema editor produces). Its presence is the marker
  ("this document describes a schema, and here it is"). *(Revised 2026-07-14 per owner: reference the
  blob's CID, don't inline the definition — keeps the schema content-addressed/immutable, and the
  hm:// document supplies the human/stable URL identity.)*
- **Authoring = combination of the account-doc + the raw schema editor** (owner's call): the raw schema
  editor produces the schema **blob** (CID) and a schema **document** at an `hm://` account path whose
  `metadata.schemaDefinition = ipfs://<cid>` points at it.
- **References are `hm://` URLs:** an instance points at `hm://<account>/schemas/person`; a
  `$ref` to another schema is that schema-document's URL; (stretch) `type` → `hm://hyper.media/<kind>`.
- **Resolution (two hops):** `hm://` URL → `unpackHmId` → `useResource(id)` →
  `document.metadata.schemaDefinition` (`ipfs://<cid>`) → fetch the schema blob by CID (`GetCID`/
  `useSchemaRegistries`) → the definition, fed to the (advisory) validator. Versioned URLs pin; bare follow latest.

### The constraint that shapes this (from the mechanics map)

`HMDocumentMetadataSchema` (`frontend/packages/client/src/hm-types.ts:528`) is a **closed** zod
object — no `.passthrough()`. Unknown metadata keys are **silently stripped on every read**
(`prepareHMDocument`, `queryResource`, `prepareHMDocumentMetadata`). The write path + daemon accept
arbitrary keys, but only **string / bool / int / null / nested-object** values (**arrays and floats
are dropped**). So: (1) the reserved key **must be added to `HMDocumentMetadataSchema`** to
round-trip; (2) the definition (which has `required`/`enum`/`oneOf` arrays) is stored **JSON-stringified**.
Reads resolve through `useResource(id).data` → `type==='document'` → `document.metadata`.

## Phased plan  (status: ✅ done · 🚧 in progress · ⬜ todo)

- ✅ **Research** — mechanics mapped (metadata is closed → must whitelist; string-encode the def;
  resolve via `useResource`; hm:// utils = `unpackHmId`/`packHmId`; migrate the `ipfs://<cid>` /
  `schema:{'/':cid}` conventions).
- ✅ **P1 · Convention + resolver** (2 commits, independently verified — web typecheck 0, ui 302, shared 961):
  - **1a** (`782971e11`) whitelisted `schemaDefinition: z.string().optional()` in `HMDocumentMetadataSchema`;
    `@shm/ui/schema-document.ts` — `isSchemaDocument`/`getSchemaDefinition`/`setSchemaDefinition` + tests.
  - **1b** (`7135ccad8`) `useSchemaDocuments(hmUrls)` resolver (pure `schemaDocumentsFromResources` core +
    thin hook over `useResources`+`unpackHmId`) → `{url → definition}` registry + tests.
- ⬜ **P2 · Authoring.** "New Schema" creates a schema *document* (marker + definition) at an
  `hm://` path; the schema editor edits that document's metadata. (Retire the raw-blob schema path
  or keep it as a low-level escape hatch.)
- ⬜ **P3 · Attachment by URL.** Instances reference their schema by `hm://` URL; migrate the
  schema-keyed-metadata feature from `ipfs://<cid>` keys to `hm://<url>` keys.
- ⬜ **P4 · Inspector/Explorer.** Recognize schema-documents (metadata marker); validate instances
  by resolving the URL; link between instance ⇄ schema by URL.
- ⬜ **P5 · Onyx dialect alignment.** `type → hm://hyper.media/<kind>`, `$ref → hm://` URLs,
  `name`/`description`; validator updated to the URL vocabulary.
- ⬜ **Back-compat / migration.** Keep reading legacy CID-based schemas; offer republish-as-document.

## Open design points (to settle with research, then confirm)

1. **The exact metadata marker + key(s).** One reserved field holding the definition, or a
   `type:"schema"` marker plus a `schema` field? Must round-trip through publish + reload and not
   be stripped by metadata whitelisting (client or daemon).
2. **Where the definition lives** — entirely in metadata, or metadata marks it + the definition is
   the document body/a block? Leaning: in metadata (simplest to read for validation).
3. **Latest vs pinned** — an instance URL without a version follows the schema's latest; with a
   version it pins. Default and UX TBD.
