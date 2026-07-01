# Architecture

How schema support is layered onto the existing blob editor. Read
[`../metadata-and-blob-editor.md`](../metadata-and-blob-editor.md) for the substrate
and [`schema-dialect.md`](./schema-dialect.md) for what schemas can express.

## Headline decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Validator | **Hand-rolled subset validator**, pure module, no new deps | The editor needs a subschema-at-path *navigator* anyway (for type suggestions); once you have the walker the validator is a thin pass. ajv is a phantom dep here (only transitively via MCP SDK), uses `new Function` codegen (CSP hazard for web, which shares `@shm/ui`), rejects our `kind` keyword in strict mode, and its magic `$ref` resolution fights our pre-fetched ipfs refs. `@cfworker/json-schema` has no custom-keyword API. In-repo precedent exists: `api-lab.ts` already hand-walks JSON Schema (`resolveSchemaNode`, `createStarterPayload`). |
| Validation posture | **Advisory only** — multi-error warnings, never blocking | Product invariant: schema-violating data is warned about, kept editable, publishable. The existing `findInvalidValue` stays untouched as the *hard* structural gate (what CBOR can encode); schema warnings are a parallel *soft* channel. Never wired into paste/JSON-apply rejection paths. |
| `$ref` resolution | **Pre-fetched registry, sync validation** | External refs are IPLD links fetched via the existing `/ipfs/{cid}.dagjson` path (react-query, cached forever — immutable content). The validator receives `Record<cid, schema>` and stays pure/sync. Unresolved ref = neutral "schema loading/unknown", never a warning. |
| Schema editor | **No new route** — the `raw-blob` page grows a schema mode | A schema is an instance of the meta-schema, so the schema editor *is* the blob editor with the meta-schema attached, plus schema-specific chrome (title, "New instance" action). Avoids: a new route key (window-state downgrade risk), and the unsolvable routing ambiguity — `ipfsUrlToRoute` decides synchronously from the CID codec alone, and schema blobs share codec 0x71 with every other DAG-CBOR blob. Detection happens post-load in the page. A dedicated route can be added later as pure presentation. |
| Attachment | Plain `schema` key holding a DAG-JSON link, stored *in the value* | Rides through undo history, JSON mode, copy/paste, dirty-check, and publish (`dagJsonToIpld` already converts it to a tag-42 link) with zero new machinery. Daemon-safe: indexers only byte-match `"type"+<KnownType>`, nothing keys off `schema`. |
| New instance | **Materialize defaults into a concrete value** at creation, passed via a `schemaCid` route param | The value editor's dispatch is value-driven — it cannot render an input for a field absent from the value. So "new instance" builds `{schema: {"/": cid}, ...defaults}` up front (extending the `createStarterPayload` idea from `api-lab.ts`). |

## Module layout

```
frontend/packages/ui/src/
  blob-schema.ts            ← pure core: dialect types, subschema walker,
                              validator, instantiator, isSchemaBlob, meta-schema
  blob-schema-context.tsx   ← SchemaContext + provider glue for the value editor
  value-editor.tsx          ← surgical schema-aware touches (badges, enum select,
                              add-field constraints, required chips)
  dag-json.ts               ← unchanged; its predicates are the kind checks
  __tests__/blob-schema.test.ts

frontend/apps/desktop/src/
  models/blob-schema.ts     ← useSchemaRegistry: fetch schema + transitive $refs
                              via useCID/useQueries into a plain registry
  pages/raw-blob.tsx        ← attach-schema UX, schema mode chrome, new-instance
                              seeding, warnings wiring, meta-schema auto-publish
frontend/packages/shared/src/
  routes.ts                 ← rawBlobRouteSchema gains optional schemaCid
  utils/navigation.tsx      ← getRouteKey includes schemaCid for 'new' blobs
```

### Layer 1 — pure schema core (`blob-schema.ts`)

No React, no IO. Fully unit-tested like `dag-json.test.ts`.

- `BlobSchema` TS types for the dialect.
- `resolveSubschema(root, path, registry) → schema | 'unresolved' | undefined` —
  walks `properties`/`items`, dereferences internal `#/$defs` refs (cycle-guarded)
  and external link refs through the registry.
- `collectSchemaRefs(schema) → cid[]` — transitive external refs for prefetching.
- `validateValue(value, schema, registry) → Warning[]` where
  `Warning = {path: ValuePath, message: string, keyword: string}`. Multi-error,
  never throws, ignores unknown keywords, uses `isDagJsonLink`/`isDagJsonBytes` for
  the `kind` checks. Path type matches the editor's `ValuePath` so warnings key by
  the same `pathId` used for row selection.
- `instantiateSchema(schema, registry) → value` — materializes `default`s, required
  properties (sensible empty values per type/kind), and enum heads; used by "new
  instance".
- `isSchemaBlob(value)` — `schema` key links to the meta-schema CID.
- `BLOB_META_SCHEMA` + `BLOB_META_SCHEMA_CID` — the meta-schema value and its
  precomputed CID (test asserts the constant matches the encoded value).

### Layer 2 — editor integration (SchemaContext)

A **separate, memo-stable** context next to `ValueEditorProvider` (deliberately not
merged into it: the existing provider value is a spread-mutated ref with new identity
every render, and `ValueEditorRules` are static constants captured in selection
handlers — schema is dynamic per-blob and must stay orthogonal).

```ts
SchemaContext: {
  subschemaAtPath(path) → schema | 'unresolved' | undefined
  warningsByPath: Map<pathId, Warning[]>
}
```

Warnings are computed **once at the root** on each committed value change (commits
are blur-driven, so this is cheap) and distributed as a map — matching the editor's
top-down immutable rebuild architecture. Recomputed from scratch after structural
edits because path identity is positional (list indices shift on reorder).

Consumption points in `value-editor.tsx` (all optional — schemaless editing is
untouched):

- **`FieldRow`/`ListItemRow`**: amber warning badge + tooltip from
  `warningsByPath` (reusing the `NumberInput` inline-error visual pattern, styled
  as warning, never gating `onValue`).
- **`ValueEditor` string/number branches**: when the subschema has `enum` and the
  value is a member, render a select; non-member values keep free text + warning.
- **`AddFieldForm`**: gains a `path` prop (it has none today); key-name suggestions
  from `properties`, type pre-selected from the suggested key's subschema, type
  options reordered (not restricted — additional properties stay addable unless the
  user is warned by `additionalProperties: false`).
- **`ObjectEditor`**: one-click "Add ‹name›" chips for required-but-missing
  properties, seeding defaults via `instantiateSchema`.

Scope: **CBOR rules contexts only** for now. The metadata editor's tombstone
semantics (`null` = deleted, hidden) conflict with `required`/`type: null`.

### Layer 3 — page integration (`raw-blob.tsx`)

- **Attach schema**: an "Attach schema…" action accepting an `ipfs://` URL or CID —
  validated as DAG-CBOR (codec 0x71) — sets `value.schema = {"/": cid}` through the
  normal `update()` path (so it's undoable). Detach = remove the key.
- **Schema fetching**: `useSchemaRegistry(schemaCid)` fetches the schema blob, then
  its transitive external refs, each with the same not-yet-found retry treatment the
  page already uses for blobs. Result: a plain registry powering SchemaContext.
- **Schema mode**: when the current value `isSchemaBlob` (or the route says
  `schemaCid === META`), the page titles itself as a schema editor, attaches the
  meta-schema for authoring assistance, and shows **"New instance"** — which
  navigates to `{key: 'raw-blob', schemaCid: <thisCid>}` (published schemas only,
  since instances need a real CID to link).
- **New instance**: on mount with `schemaCid`, seed
  `instantiateSchema(schema) + {schema: link}` as the initial value.
- **"New Schema"** menu item beside "New Blob" in the document options dropdown —
  just `{key: 'raw-blob', schemaCid: META_SCHEMA_CID}`.
- **Meta-schema publish**: publishing any schema also publishes the meta-schema blob
  in the same `PublishBlobs` call, so the `schema` link always resolves.
- **Warnings summary**: a gentle banner near the CID line ("3 fields don't match the
  attached schema") — informational, publish stays enabled.

## Data flow

```
route {key:'raw-blob', cid?, schemaCid?}
  ├─ cid → useCID → value (DAG-JSON) ──────────────┐
  ├─ schemaCid (new instance) → instantiateSchema ─┤
  ▼                                                ▼
value.schema link → useSchemaRegistry → {schemas by cid}
  ▼                                                ▼
validateValue(value, schema, registry) → Map<pathId, Warning[]>
  ▼
SchemaContext → ValueEditor tree (badges, selects, suggestions, chips)
  ▼ (user edits; warnings recomputed on commit)
publish: dagJsonToIpld → dag-cbor → sha256 → CIDv1 → PublishBlobs
         (schema link becomes a real tag-42 IPLD edge)
```

## Sharp edges we're inheriting or accepting

- **Daemon indexer byte-match collision** (pre-existing, now likelier): any blob
  whose CBOR bytes contain `"type"` immediately followed by a registered type string
  (`Comment`, `Change`, `Ref`, `Capability`, `Contact`, `Profile`) at *any* depth
  triggers a strict decode + signature verification; failure aborts the whole
  `PutMany` and `StoreBlobs` fails with an opaque Internal error
  (`backend/blob/index_registry.go:61`, `index_blockstore.go:90`). JSON Schema's
  lowercase type names are safe, but an instance with a legit `type: "Ref"` field
  will hit it. Mitigation options (daemon-side skip when `signer`/`sig` absent, or a
  client-side pre-publish check + friendly warning) tracked in
  [`plan.md`](./plan.md); not a v1 blocker.
- **`"/"` property names** are unrepresentable (DAG-JSON reservation); the schema
  editor forbids them.
- **Immutability UX**: attaching/editing anything mints a new CID; editing a schema
  does not update its instances. Copy must make this legible.
- **`raw-blob:new` mount key**: with `schemaCid` in play, the route key must include
  it so "New Blob" and "New instance of X" don't share component state.
- **Unpublished content is renderer state only** — a restart loses a typed-but-
  unpublished value; the `schemaCid` route param survives (it re-shapes an empty
  form), the typed data does not. Pre-existing raw-blob limitation.
