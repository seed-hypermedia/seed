# Implementation plan & status

Source of truth for progress. Status values: `todo` / `in progress` / `review` / `done`.

## Phase 1 — Schema core (pure logic) — `done`

`frontend/packages/ui/src/blob-schema.ts` + 61 tests in
`__tests__/blob-schema.test.ts`. Delivered as planned:

- [x] Dialect TS types (`BlobSchema`, `SchemaWarning`, `SchemaRegistry`)
- [x] `resolveSubschema` — properties/items walker; internal `#/…` JSON-pointer
      refs (cycle-guarded via visited set, cycles → `'unresolved'`); external
      link refs via registry; ref-chain roots tracked so pointers resolve within
      the blob the ref appears in
- [x] `collectSchemaRefs` — external `$ref` + `targetSchema` CIDs, transitive
      through present registry entries (callers fetch iteratively)
- [x] `validateValue` — multi-error, advisory, never throws, depth-guarded,
      unknown/malformed keywords ignored, bigint-tolerant numbers
- [x] `instantiateSchema` — default → const → enum[0] → per-type zero values;
      required-only object seeding; link/bytes omitted (can't be fabricated)
- [x] `isSchemaBlob`, `BLOB_META_SCHEMA`, `BLOB_META_SCHEMA_CID`
      (`bafyreialsztuxfggquxs4vskfz44kqcmbchtdb6i2fscupnbywzc4l4x5m`; a test
      recomputes the CID from the encoded value so drift is impossible)

## Phase 2 — Schema-aware value editor — `done`

- [x] `blob-schema-context.tsx`: `BlobSchemaProvider` (memo-stable, separate
      from ValueEditorProvider) computes warnings once per committed change,
      keyed by pathId; hooks: `useSubschema`, `useSchemaWarnings`,
      `useBlobSchema`, `useSchemaWarningCount`. The reserved `schema` key is
      excluded from warnings.
- [x] `value-editor-schema.tsx`: `SchemaWarningBadge` (amber, tooltip),
      `EnumValueSelect`, `suggestedFieldType`, `useSchemaFieldSuggestions`,
      `SchemaFieldChips`
- [x] Badges on `FieldRow`/`ListItemRow`
- [x] Enum → select for **string** leaves whose value is an enum member
      (non-members keep free text + warning; number enums deferred)
- [x] `AddFieldForm`: `path` prop; "Schema fields:" suggestion chips set
      key + type; list add pre-selects the items type
- [x] `SchemaFieldChips` in `ObjectEditor`: instant-add for **required**
      missing fields with instantiated values (optional fields live in the add
      form's suggestions; link/bytes always go through the form)
- [x] All additive — schemaless editing unchanged; full ui suite passes (224)

Deviation from plan: the add-form's type Select options are not reordered by
schema — the suggestion chips pre-select the type instead, which is clearer.

## Phase 3 — Page & route integration (desktop) — `done`

- [x] `rawBlobRouteSchema.schemaCid` + mount-key separation (`getRouteKey`)
- [x] `useSchemaRegistry` (desktop model): useQueries over the iteratively
      discovered ref closure, same cache keys as `useCID`, 15s refetch for
      still-missing blobs, `isComplete` signal
- [x] Attach/Change Schema: inline bar from the options menu; accepts CID or
      `ipfs://` URL, requires DAG-CBOR codec; sets `value.schema` via the
      normal undoable update. Detach = remove the field like any other.
- [x] Schema mode: `isSchemaBlob` detection; the meta-schema is **built into
      the app** and never fetched (bootstrap: it can't link itself, and it must
      work before ever being published); "New Instance of this Schema" menu
      action on published schemas
- [x] New-instance seeding from `schemaCid` (`NewInstanceEditor`):
      `instantiateSchema` + `schema` link; non-object starters fall back to
      `{schema}` only
- [x] "New Schema" menu item = new instance of the meta-schema
- [x] Meta-schema published alongside any schema publish (same `PublishBlobs`
      call; pinned-CID drift test runs the exact publish pipeline)
- [x] `SchemaStatusRow`: schema identity + open button, loading state,
      "N fields don't match the schema — kept as-is" / "Matches schema";
      publish never blocked
- [ ] Forbid `"/"` property names in schema authoring (still open — currently
      only documented)

## Phase 4 — Hardening & docs — `done`

- [x] Adversarial review workflow (4 review dimensions × per-finding
      adversarial verification, 27 agents): **20 confirmed findings, all
      fixed** in commit `7f1340467`; 3 rejected as not-real. Highlights:
      - *Critical*: an enum containing `""` crashed the whole editor (Radix
        SelectItem throws) → such enums fall back to free text. An unfindable
        schema CID threw to the page error boundary after query retries
        (app-default `useErrorBoundary: true`), destroying unpublished edits
        → schema fetches and `useCID` never throw to the boundary.
      - *Major*: ReDoS via a remote schema's `pattern` (`(a+)+$` froze the
        renderer) → size caps + nested-quantifier heuristic + memoization,
        skipped patterns are neutral. A late-arriving schema unmounted a
        focused text input, silently dropping the draft → string leaves latch
        free-text mode while focused; the enum select gained a "Custom
        value…" escape hatch.
      - Plus 16 smaller correctness/UX fixes (prototype-chain-safe property
        checks, numeric-only bigint equality, `$ref` depth-guard semantics,
        attach-schema guards for user-owned `schema` fields / link roots /
        JSON mode, root-warning visibility, registry identity, ref fold-in
        re-arming). 16 regression tests added.
- [x] Tests: schema-linked instance encode round-trip; meta-schema pinned CID
      through the publish pipeline; new-schema starter recognized by
      `isSchemaBlob`; route param tests (shared); jsdom rendering tests for
      badges/enum-select/chips/no-schema-unchanged
- [x] `"/"` field name reserved in add-field and rename (DAG-JSON reservation)
- [x] `useSchemaRegistry` registry identity stabilized (provider memo works;
      closure-folding effect keyed on content, not array identity)
- [x] **Live-daemon end-to-end verification** (local seed-daemon, gRPC
      `StoreBlobs` + HTTP `.dagjson`): meta-schema, an Article schema, and an
      instance published with client-computed CIDs — daemon verified and
      echoed all three; served back with the full IPLD link chain intact
      (instance→schema→meta); served schema passes `isSchemaBlob`; served
      instance validates clean; a mutated instance warns without throwing.
- [x] Daemon indexer `"type"+KnownType` collision: `findSeedIndexerCollision`
      reproduces the daemon matcher client-side; publish failures now explain
      the collision instead of the opaque Internal error. Never pre-blocks.
      **Verified live**: `{type:"Comment"}` rejected by the daemon with the
      predicted error; JSON-Schema-style `{type:"object"}` stores fine.
- [x] Final docs sweep to as-built state; user-facing walkthrough
      ([`walkthrough.md`](./walkthrough.md))

## Final state

All phases complete. Suites: ui 240, desktop 548, shared 927 — all green;
full-workspace typecheck clean. End-to-end verified against a live local
daemon (publish chain, read-back, validation, collision behavior).

## Deliberately out of scope (v1)

- `oneOf`/`anyOf`/`allOf`, conditionals, type arrays, `format` (see dialect doc)
- Number-enum selects (string enums only; number enums still validate)
- Deep `targetSchema` validation (hint-only)
- Schema support in the metadata editor (tombstone/null semantics conflict)
- A dedicated `schema-editor` route (schema mode lives in `raw-blob`)
- Web surface for the blob/schema editor
- Export converter to portable vanilla JSON Schema
