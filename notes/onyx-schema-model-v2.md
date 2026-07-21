# Onyx schema model v2 — corrected schema bindings

Corrects the "biggest misunderstanding": `schemaDefinition` never meant "this doc
conforms to this schema." There are **three distinct** document metadata fields,
all declared on the **baseDocument** schema.

## The three fields (all live on the document's metadata)

| field | meaning | value |
|---|---|---|
| `schema` | the schema **this** document conforms to | ipfs CID **or** `hm://account/path` |
| `childrenSchema` | the schema this document's **children** must conform to | ipfs CID **or** `hm://account/path` |
| `schemaDefinition` | this document **describes/defines** a schema (so others can reference it by URL) | `ipfs://<cid>` of a schema blob |

- A child's **effective** schema = its own `schema`, else its parent's `childrenSchema`.
  A child that declares `schema` must descend from baseDocument **and** the parent's `childrenSchema`.
- `schemaDefinition` docs are the reference targets: `hm://acme/person` is a document
  that *describes* a person and points `schemaDefinition` → the person schema blob.
  Another doc conforms by setting `schema: hm://acme/person` (resolved via that doc's `schemaDefinition`).

## baseDocument

`hm://seed.hyper.media/document` (bundled `hypermedia-document`): `{ metadata, content }`.
- `metadata` → `hypermedia-metadata` (now carrying `schema` / `childrenSchema` / `schemaDefinition`).
- `content` → list of `hypermedia-block-node` (the recursive block tree).

Every typed document schema **extends** baseDocument via `ref: hm://seed.hyper.media/document`
and refines `metadata` (e.g. person adds required `surname` to `metadata`).

**Conformance → required metadata fields:** resolve the effective schema; if it is
document-shaped (has a `metadata` property) use `resolved.properties.metadata.required`;
if it is a flat map (legacy, e.g. today's foo1) use `resolved.required`. Both supported.

## Schema references by HM url

A schema reference is one of:
1. **ipfs CID** — resolve the blob directly (bundled `schemaForCid`, else `GetCID`).
2. **`hm://account/path`** — `useResource(id)` → `document.metadata.schemaDefinition` → CID → blob.
3. **bundled library ref** (`hm://hyper.media/string`, …) — resolved locally (unchanged).

HM-url refs are allowed in `schema`, `childrenSchema`, `extends` (ref), and nested
subschemas (map property / list item). Resolution is async (network) → a React hook layer.

## Publishing: schema `.json` + companion `.md`

Every `schemas/<name>.json` has a co-located `schemas/<name>.md` explaining the concept.
The sync publishes, under the onyx account:
- the schema DAG-CBOR blob (CID verified vs `schemas.lock.json`);
- a document at `hm://<onyx>/<name>` whose **content** is the `.md` and whose
  metadata **`schemaDefinition`** = `ipfs://<schema CID>`.

So `hm://<onyx>/example-person` becomes the referenceable "person" schema URL.

## Error handling

Schema violations never block writing. Out-of-spec metadata/content surfaces as
**red, non-blocking** advisory UI (which field, what rule) — guardrails, not gates.

---

## Phased plan

1. **Data model** — extend `hypermedia-metadata` with the 3 fields; add
   `hypermedia-block-node` + `hypermedia-document`; worked-example doc schemas;
   regenerate bundle + lockfile; reference-validate. *(additive, safe)*
2. **Publishing** — co-locate `<name>.md` beside every `<name>.json`; update the
   sync to publish each pair as `hm://<onyx>/<name>` with `schemaDefinition` = CID.
3. **Resolution** — `useResolvedSchema(ref)` (CID + HM-url, async) and
   `useEffectiveDocSchema(id, metadata)` (own `schema` else parent `childrenSchema`).
4. **UI** — drive required-metadata off the *resolved conformance schema* (not
   `schemaDefinition`); `schemaDefinition` docs keep Schema/Create header actions
   (Create makes a doc whose `schema` = this def's URL); **red error UI** for
   out-of-spec data across metadata + content.

Consumers to rewire (all in `packages/ui/src`, transitive to web+desktop):
`required-attributes-editor.tsx`, `document-metadata-view.tsx`,
`resource-page-common.tsx`, `onyx/schema-document.tsx`, `onyx/onyx-metadata-schema-keys.ts`.
