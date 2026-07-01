# Project workflow & agent setup

How the blob-schemas project is being executed, for anyone watching along.

## Execution model

The work runs as a sequence of **phased multi-agent workflows**, with the main
session (this one) as orchestrator. Between phases the orchestrator reads results,
updates these docs, commits, and decides the next fan-out. Nothing is fire-and-forget:
every phase's output is reviewed before the next starts.

### Phase 1 — Research (workflow: `blob-schema-research`)

Five parallel readers, each returning a structured map (`summary`, `keyFiles`,
`extensionPoints`, `risks`, `recommendations`):

| Agent | Area |
| --- | --- |
| `read:value-editor` | `packages/ui/src/value-editor.tsx` + `dag-json.ts` internals; where schema-awareness hooks in |
| `read:publish-path` | `raw-blob.tsx`, `useCID`, `PublishBlobs`, daemon `.dagjson` endpoint; how schema blobs publish and whether a `schema` key conflicts with anything the daemon indexes |
| `read:routing` | Desktop route/page/omnibar recipe for a new `schema-editor` route; document-options dropdown wiring |
| `read:validation-ecosystem` | Existing zod / `zod-to-json-schema` usage; validator options (ajv vs `@cfworker/json-schema` vs hand-rolled) against our needs: path-level errors, gentle mode, pluggable async `$ref` resolution |
| `research:dialect-design` | Prior art (IPLD Schemas, DAG-JSON forms, RJSF), how to correctly extend JSON Schema 2020-12, `$ref` semantics under content addressing |

### Phase 2 — Planning

Orchestrator synthesizes research into `architecture.md`, `schema-dialect.md`, and
`plan.md`, then commits. This is the main human checkpoint: the dialect and
architecture are much cheaper to change here than after code exists.

### Phase 3+ — Implementation

Work splits into largely-independent tracks, sized so each is one focused agent or
inline session:

1. **Schema core** (pure logic, `@shm/ui` or `@shm/shared`): dialect types, gentle
   validator with per-path errors, `$ref`-over-`ipfs://` resolution, schema→editor
   hints mapping. Heavily unit-tested; no UI dependencies.
2. **Schema-aware value editor**: thread a schema context through the recursive
   editor — constrained add-field picker, enum selects, required hints, warning
   badges. Must not regress schemaless editing.
3. **Schema editor page**: new desktop route + page for authoring schemas (itself a
   schema-aware value-editor instance — the dialect has a meta-schema), publish flow,
   "create instance" action.
4. **Blob editor integration**: attach-schema-by-URL UI, `schema` link field
   handling, fetching the schema blob, validation warnings, new-instance route
   parameters.

Tracks 2–4 depend on 1; 2 and 3 can run in parallel after 1. Adversarial review
passes (fresh agents told to break the validator / find data-loss paths) run before
each track merges.

## Commit strategy

Frequent, scoped commits on the `document-metadata-view` branch (or a child branch if
it diverges): docs commits as understanding evolves, one or more commits per
implementation track, tests alongside. `pnpm typecheck && pnpm format:write` before
each commit per project convention.

## Docs discipline

These docs are the project's live state — updated *as part of* each phase, not after.
`plan.md` carries per-task status. If you're reading this mid-project, `plan.md` is
the source of truth for what's done.
