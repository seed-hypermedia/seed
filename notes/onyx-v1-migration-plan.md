# Migrating v1 "Seed Blob Schema" → Onyx, and ripping out v1

**Goal:** make the Onyx engine (`frontend/packages/ui/src/onyx/*`) the single schema
system, replace every consumer of the v1 JSON-Schema stack, and delete the v1 files.
Onyx supersedes v1 (self-describing, generics, `hm://` name-refs, one proven
validator), so this is consolidation, not feature loss — with two deliberate
design bridges (below).

Execute **sequentially**, keeping `pnpm --filter @shm/ui typecheck` + the @shm/ui,
web, and desktop test suites green after **each** numbered step. The files
interlock inside `@shm/ui`, so do NOT parallelize with agents on the same files.

---

## 0. The two dialects (what the migration must bridge)

| | v1 "Seed Blob Schema" | Onyx |
| --- | --- | --- |
| kind | `type:"object"`, `"array"`, `"string"`… | `type:"hm://hyper.media/map"` etc. (kind URL) |
| union | `oneOf` | `anyOf` |
| ref | `$ref` = `{"/":cid}` (CID link) | `ref` = `hm://` name (resolved to a CID for pinning) |
| open map | `additionalProperties` | `values` |
| schema-blob detection | reserved `schema` link == `BLOB_META_SCHEMA_CID` (`isSchemaBlob`) | a value that validates against the meta-schema (`onyx-schema`) |
| registry | `useSchemaRegistries(cids)` fetches + follows `$ref` closure → `Record<cid,BlobSchema>` | bundled `ONYX_SCHEMAS` + (new) fetch-by-CID for unbundled |
| validation | `validateValue(value, schema, registry)` (advisory) | `validate(schema, value, path?, env?, reg?)` (engine) |

Two bridges the rip-out introduces:

1. **`isOnyxSchema(value)`** — replaces `isSchemaBlob`. A blob is an Onyx schema iff
   `validate(ONYX_SCHEMAS['onyx-schema'], value).length === 0`. (Add to `onyx-engine.ts`.)
2. **Onyx registry hook** — replaces `useSchemaRegistries`. `useOnyxSchemaRegistry(cids)`:
   for each CID, resolve from `ONYX_SCHEMAS` via `schemaForCid`, else `useCID(cid)`
   (`@shm/shared/models/entity`) to fetch the raw blob; return an `OnyxRegistry`
   (merged with bundled). Onyx name-refs resolve against the bundle, so the transitive
   fetch closure v1 needed is largely unnecessary. (Add `onyx-schema-registry-cid.tsx`.)

---

## 1. New Onyx APIs to build first (unblock all consumers)

Create these in `frontend/packages/ui/src/onyx/` so every later step has a target:

- **`onyx-engine.ts`** — add `isOnyxSchema(value): boolean`.
- **`onyx-schema-registry-cid.tsx`** — `useOnyxSchemaRegistry(cids: string[]): {registry: OnyxRegistry; isLoading; isComplete}` (fetch-by-CID, above). Replaces `blob-schema-registry.ts` `useSchemaRegistries` and desktop `models/blob-schema.ts` `useSchemaRegistry`.
- **`onyx-schema-context.tsx`** — mirror `blob-schema-context.tsx`'s API on Onyx:
  `OnyxSchemaProvider({schema, registry, value, children})`, `useSubschema(path)`
  (walk with `resolveSchema` + descend `properties`/`items`/`values`), `useOnyxSchema()`,
  `useSchemaWarnings(path)` + `useSchemaWarningCount()` (path-keyed map from `validate`).
- **Onyx port of `value-editor-schema.tsx`** — same exported names so `value-editor.tsx`
  needs only an import-path change: `EnumValueSelect`, `literalEnumOptions`,
  `SchemaFieldChips`, `SchemaWarningBadge`, `suggestedFieldType`, `useSchemaFieldSuggestions`,
  `useSchemaKeyLabel`, `type LiteralOption`. Compute from Onyx schemas:
  - `suggestedFieldType(onyxSchema)` → `kindOf(schema.type)` → text/number/toggle/object/list/null/link/bytes.
  - `literalEnumOptions` / `EnumValueSelect` ← Onyx `enum` on a resolved scalar (already have `EnumValueSelect` behavior inline in `value-editor.tsx`'s StringLeafEditor; extract/reuse).
  - `useSchemaFieldSuggestions` / `SchemaFieldChips` ← `Object.keys(resolveSchema(schema).schema.properties)`.
  - `useSchemaKeyLabel` ← if a field key is `ipfs://<cid>`, `schemaForCid(cid)?.name`.
- **`instantiate`** — `seedValue(schema, registry)` (already in `onyx-data-editor.tsx`)
  replaces `instantiateSchema` / `instantiateAtPath`.
- **Schema authoring editor** — the `OnyxDataEditorPanel` pointed at `ONYX_SCHEMAS['onyx-schema']`
  replaces `BlobSchemaEditor` (self-hosting: editing the meta-schema *builds a schema*).

---

## 2. Consumer migration (per file)

### 2a. `frontend/packages/ui/src/value-editor.tsx` (deepest coupling — do carefully)
Current v1 imports: `instantiateAtPath` (`./blob-schema`), `useBlobSchema`/`useSubschema`
(`./blob-schema-context`), and the `value-editor-schema` block (line 42-51).
→ Repoint all three to the Onyx equivalents from step 1 (same symbol names). `instantiateAtPath`
→ a small `seedValue`-based helper for the add-field path. Verify: `value-editor-*.test.tsx`
(keyboard/ipfs/newblob/field-type) stay green — these are UX tests, not schema-dialect tests,
so they should pass unchanged once the imports resolve.

### 2b. `frontend/packages/ui/src/document-metadata-view.tsx`
v1 imports: `instantiateSchema`, `BlobSchemaProvider`, `buildSchemaKeyRoot`/`collectSchemaKeyCids`/`schemaKeyCid`, `useSchemaRegistries`.
→ `BlobSchemaProvider`→`OnyxSchemaProvider`; `useSchemaRegistries`→`useOnyxSchemaRegistry`;
`instantiateSchema`→`seedValue`. The **schema-keyed field** feature (a field whose *key* is
`ipfs://<cid>`) becomes Onyx-driven: `schemaKeyCid` stays (pure CID parse — move to onyx),
`buildSchemaKeyRoot`/`collectSchemaKeyCids` → build an Onyx root map schema keyed by those CIDs
(resolve each via `schemaForCid`). Note this now coexists with the new document-level
`schemaDefinition` flow (already Onyx) — decide whether to keep schema-keyed *fields* at all,
or deprecate them in favor of `schemaDefinition`. **Recommendation: keep for now** (they're
orthogonal: field-level vs document-level typing).

### 2c. `frontend/packages/ui/src/inspect-ipfs-page.tsx`
v1 import: `isSchemaBlob` (`./blob-schema`). → `isOnyxSchema` (step 1). `inspectorBlobActions`
already returns Onyx-shaped actions; only the detection predicate changes. Update
`__tests__/inspect-ipfs-page.test.ts` fixtures to Onyx schema blobs.

### 2d. `frontend/apps/explore/src/components/IPFS.tsx`
v1 imports: `validateValue`, `useSchemaRegistries` (`@shm/ui/blob-schema*`).
→ `validate` + `useOnyxSchemaRegistry`. (Explore has its own 11-test suite; keep green.)

### 2e. `frontend/apps/desktop/src/pages/raw-blob.tsx` + `frontend/apps/web/app/web-raw-blob.tsx`
v1 imports: `BLOB_META_SCHEMA`, `BLOB_META_SCHEMA_CID`, `instantiateSchema`, `isSchemaBlob`,
`SchemaRegistry` (`@shm/ui/blob-schema`); `BlobSchemaProvider`/`useSchemaWarningCount`/`useSchemaWarnings`
(`-context`); `BlobSchemaEditor` (`-editor`); `useSchemaRegistry`/`useSchemaRegistries`.
→ The biggest UI swap. `BlobSchemaEditor` → `OnyxDataEditorPanel` on the meta-schema for the
"New Schema" flow; `isSchemaBlob`→`isOnyxSchema`; `instantiateSchema`→`seedValue`;
`BLOB_META_SCHEMA_CID` → the Onyx meta-schema CID (`schemaCid('onyx-schema')`); context/registry
→ Onyx equivalents. Desktop `@/models/blob-schema` `useSchemaRegistry` wrapper → an Onyx wrapper
or inline `useOnyxSchemaRegistry`. Rewrite `raw-blob-schema-parity.test.tsx` / `web-raw-blob.test.tsx`
against the Onyx editor.

### 2f. `frontend/apps/desktop/src/pages/desktop-resource.tsx`
v1 import: `BLOB_META_SCHEMA_CID` (used for the "New Schema" menu → `{key:'raw-blob', schemaCid}`).
→ `schemaCid('onyx-schema')` (or point "New Schema" at the Onyx new-schema route/flow).

---

## 3. Delete v1 sources (only after 2a-2f typecheck clean with no v1 imports left)
`git rm` these 9 files:
`blob-schema.ts`, `blob-schema-edit.ts`, `blob-schema-editor.tsx`, `blob-schema-registry.ts`,
`blob-schema-context.tsx`, `value-editor-schema.tsx`, `schema-document.ts`,
`schema-document-registry.ts`, `hypermedia-blob-type.ts`.
Then `git grep -nE "blob-schema|/schema-document|hypermedia-blob-type|value-editor-schema|BlobSchema|isSchemaBlob|validateValue"` must return only Onyx files + this note.
Also drop the desktop `@/models/blob-schema` wrapper and the `@shm/ui` package.json/exports
entries for the removed files if any.

## 4. Migrate/remove the 14 v1 test files
- **Delete** (purely v1-dialect, no Onyx analog): `blob-schema.test.ts`, `blob-schema.probe.test.ts`,
  `blob-schema-edit.test.ts`, `hypermedia-blob-type.test.ts`, `schema-document.test.ts`,
  `schema-document-registry.test.ts`, `value-editor-schema.test.tsx`, `blob-schema-editor.test.tsx`.
- **Rewrite for Onyx**: `metadata-schema-keys.test.tsx` (schema-keyed fields on Onyx),
  `raw-blob-schema-parity.test.tsx` + `web-raw-blob.test.tsx` (Onyx authoring editor),
  `inspect-ipfs-page.test.ts` (Onyx `isOnyxSchema` fixtures), `raw-blob-encoding.test.ts`
  (encoding is dialect-neutral — likely passes as-is), `hm-entity-field.test.tsx` (keep;
  `hm-entity-field.tsx` is dialect-neutral and is NOT deleted).
- Keep the new Onyx tests (`onyx/__tests__/*`) as the coverage of record.
- Net expectation: coverage stays comparable (~the same behaviors, Onyx-dialect).

## 5. Sanity: things that are NOT v1 and must stay
`hm-entity-field.tsx` (hm:// reference field — dialect-neutral, used by Onyx too),
`dag-json.ts`, `ipfs-publish.ts`, `value-editor.tsx` itself (only its schema-awareness backend
changes), and everything under `onyx/`.

---

## Suggested order (each step: typecheck + tests green before the next)
1. Step 1 — build the new Onyx APIs (`isOnyxSchema`, registry hook, context, `value-editor-schema` port). No consumer changes yet; add unit tests.
2. 2c + 2d (inspector + explore) — smallest, self-contained; proves the registry/detection bridge.
3. 2a (value-editor) — repoint imports; run the value-editor UX test suite.
4. 2b (metadata view) — schema-keyed fields on Onyx.
5. 2e + 2f (raw-blob authoring + desktop menu) — the big editor swap.
6. Step 3 — delete v1 sources; `git grep` clean.
7. Step 4 — delete/rewrite the 14 tests; full suites green.
8. Format the workspace; commit.

## Risks
- **value-editor.tsx** is used by the metadata editor AND raw-blob — its schema backend swap is the highest-risk change; the same-named-API port (step 1) is what keeps it a mechanical import repoint.
- **Real fetched (unbundled) schemas** — `useOnyxSchemaRegistry` must fetch-by-CID for schemas not in the bundle; the tour's schemas are all bundled, but user-authored schemas won't be. Test both paths.
- **web-raw-blob / raw-blob parity tests** encode explicit CIDs — the Onyx meta-schema CID differs from `BLOB_META_SCHEMA_CID`; update fixtures.
- Keep the 560+ desktop and 138+ web tests green throughout; run them per step, not just at the end.
