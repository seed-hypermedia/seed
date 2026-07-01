# Implementation plan & status

Source of truth for progress. Status values: `todo` / `in progress` / `review` / `done`.

## Phase 1 — Schema core (pure logic) — `in progress`

New module `frontend/packages/ui/src/blob-schema.ts` + tests. No React, no IO.
Everything below is unit-testable in isolation.

- [ ] Dialect TS types (`BlobSchema`, `Warning`) per [`schema-dialect.md`](./schema-dialect.md)
- [ ] `resolveSubschema(root, path, registry)` — properties/items walker, internal
      `#/$defs` refs (cycle-guarded), external link refs via registry
- [ ] `collectSchemaRefs(schema)` — transitive external ref CIDs for prefetch
- [ ] `validateValue(value, schema, registry) → Warning[]` — multi-error, advisory,
      unknown keywords ignored, `kind` via `isDagJsonLink`/`isDagJsonBytes`
- [ ] `instantiateSchema(schema, registry)` — defaults, required seeding, enum heads
- [ ] `isSchemaBlob(value)` + `BLOB_META_SCHEMA` + `BLOB_META_SCHEMA_CID`
      (test asserts the CID constant matches the encoded meta-schema)
- [ ] Tests: `packages/ui/src/__tests__/blob-schema.test.ts` covering every keyword,
      ref cycles, unresolved refs, kind mismatches, bigint/precision tolerance

## Phase 2 — Schema-aware value editor — `todo`

`frontend/packages/ui/src/` — SchemaContext + surgical touches to `value-editor.tsx`.
Must not regress schemaless editing (all consumption optional).

- [ ] `SchemaContext` (separate from ValueEditorProvider, memo-stable value):
      `subschemaAtPath`, `warningsByPath`
- [ ] Warning badges on `FieldRow`/`ListItemRow` (amber, tooltip, never gating)
- [ ] Enum → select for string/number leaves (member values only; never coerce)
- [ ] `AddFieldForm`: add `path` prop; key suggestions from `properties`; type
      pre-selection; options reordered not restricted
- [ ] Required-but-missing "Add ‹name›" chips in `ObjectEditor`
- [ ] Root warnings recompute on committed changes; positional-path invalidation on
      structural edits

## Phase 3 — Page & route integration (desktop) — `todo`

- [ ] `rawBlobRouteSchema` gains optional `schemaCid`; `getRouteKey` includes it
- [ ] `useSchemaRegistry(cid)` model: fetch schema + transitive refs (retry treatment
      matching the existing blob-searching loop)
- [ ] Attach/detach schema UX in `raw-blob.tsx` (paste `ipfs://` URL / CID,
      validate codec 0x71, set `value.schema` via normal undoable update)
- [ ] Schema mode: detection via `isSchemaBlob`, "Schema" chrome, meta-schema
      attached for authoring, **New instance** action (published schemas only)
- [ ] New-instance seeding from `schemaCid` route param (`instantiateSchema` +
      `schema` link)
- [ ] "New Schema" menu item next to "New Blob" (`desktop-resource.tsx`)
- [ ] Meta-schema auto-published alongside any schema publish (same `PublishBlobs`
      call)
- [ ] Warnings summary banner near the CID line; publish never blocked
- [ ] Forbid `"/"` property names in schema authoring

## Phase 4 — Hardening & docs — `todo`

- [ ] Adversarial review pass: fresh agents hunting data-loss paths ("can schema
      state ever block/destroy user data?") and validator wrong-warning cases
- [ ] Tests: desktop encode round-trip of a schema-linked instance; route param
      tests; schema-mode detection tests
- [ ] Decide/implement mitigation for the daemon indexer `"type"+KnownType`
      byte-match collision (client-side pre-publish check at minimum)
- [ ] Update all docs in this dir to as-built state; add a user-facing walkthrough

## Deliberately out of scope (v1)

- `oneOf`/`anyOf`/`allOf`, conditionals, type arrays, `format` (see dialect doc)
- Deep `targetSchema` validation (hint-only: UI labels + create-linked-blob)
- Schema support in the metadata editor (tombstone/null semantics conflict)
- A dedicated `schema-editor` route (schema mode lives in `raw-blob`)
- Web surface for the blob/schema editor (primitives all work on web already)
- Export converter to portable vanilla JSON Schema (`{"/": cid} ⇄ ipfs://` strings,
  `kind` → structural form) — designed in the dialect doc, build when needed
