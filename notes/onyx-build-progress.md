# Onyx build progress

**Watch this file** for live progress. Updated as I go. Status: ✅ done · 🚧 in progress · ⛔ blocked · ⬜ todo.

Branch: `onyx2` (off `feat/schemas`). Reference system: `schemas/` (Onyx) + tour.

---

## 0 · Current state (done)

- ✅ Onyx type system + `validate.mjs` (257 checks) + `publish.mjs` (deterministic CIDs → `schemas.lock.json`) + `tour.mjs` explorer.
- ✅ Full schemafication of the six CBOR blob types, block model (strict core + open + extension), `Change<Block>` generics.
- ✅ Integration roadmap: [`onyx-integration-plan.md`](./onyx-integration-plan.md).

---

## 1 · ✅ DECIDED — Onyx canonical, absorb v1  *(2026-07-13)*

**Onyx is the canonical base.** Fold v1's best ideas into it — value constraints
(`minLength`/`pattern`/`format`/`min`/`max`), advisory (warn-don't-block) validation,
optional JSON-Schema-2020-12 compatibility — and **evolve the existing
`blob-schema-editor` to be Onyx-backed** (reuse its UX; don't rewrite). Onyx keeps
name-refs (recursion), generics, and self-hosting. This is the direction for §2.

Original comparison kept below for reference.

---

### (reference) Onyx vs. "Seed Blob Schema v1"

Research turned up an **existing, actively-developed schema system on this branch**:
**Seed Blob Schema v1** (`docs/blob-schemas/`, `frontend/packages/ui/src/blob-schema*`,
an 889-line `blob-schema-editor.tsx`). It overlaps heavily with Onyx. We must pick a
direction before building editors, because the editor's form logic depends on the dialect.

| | **Onyx** (this session) | **Seed Blob Schema v1** (feat/schemas) |
| --- | --- | --- |
| basis | from-scratch minimal, self-hosting | **JSON-Schema-2020-12 subset** (+ IPLD) |
| ecosystem | custom | **standard JSON-Schema tooling works** (degrades unknown keywords) |
| refs | **`hm://` names → real recursion + mutual recursion** | **CIDs** → hits the fixpoint; recursion limited (meta-schema is "the one exception") |
| generics | **yes (`params`/`var`/`args`, `Change<Block>`)** | no |
| maps | **closed by default** (rejects unknown keys) | open by default (`additionalProperties`) |
| unions | `anyOf` | `oneOf` |
| value constraints | none (kind only) | **`minLength`/`pattern`/`format`/`min`/`max`** |
| validation | strict (reject) | **advisory (warn-don't-block)** |
| editor/GUI | tour (standalone, beautiful) | **in-app editor + metadata integration + developer mode** |
| labels | `name`/`description` | `title`/`description` |
| self-describing | yes (union of variants) | yes (meta-schema, `schema` link convention) |

**The decisive technical point:** the real data is *deeply recursive* (comments have
replies; the change→op→block stack; documents referencing documents). Onyx's **name-refs**
express that; v1's **CID-refs cannot** (the fixpoint). Conversely, v1 is **further along
in the app**, **JSON-Schema-compatible**, and has **value constraints + advisory validation**
that real forms need.

**Recommendation:** make **Onyx the canonical base** (its recursion + generics + self-hosting
are the hard-won capabilities), and **absorb v1's best ideas** — value constraints, advisory
validation, and optionally JSON-Schema-2020-12 compatibility — then **evolve the existing
`blob-schema-editor` to be Onyx-backed** (reuse its UX, don't rewrite from scratch). This
matches the stated goal ("integrate Onyx", "replace hm-types with Onyx").

→ **Awaiting your call** (see the question I asked). Everything below is provisional on it.

---

## 2 · The GUI build (provisional plan)

The self-describing insight: **one schema-driven data editor** gives all three —
the **schema editor** is it pointed at the meta-schema; the **metadata editor** is it
pointed at `hypermedia-metadata`. Build order:

- ✅ **Editor engine** (`schemas/editor-client.js`) — recursive schema → form renderer + live validator
  (validator ported verbatim from `validate.mjs`). map→fields (lazy optional), list→add/remove,
  open-map→dynamic entries, enum→select, union→variant picker, scalar→input, link/bytes→wrapped input,
  ref/extension/generics→resolved. Depth-guarded for recursive schemas. Verified in a real browser (Playwright).
- ✅ **JSON data editor** in the tour — "Data editor" on every schema page; live dag-json + validation. (`tour.mjs`)
- ✅ **Schema editor** — the same editor pointed at the meta-schema builds a *schema* (self-hosting). Verified.
- ✅ **Instance editor** — instance pages seed the editor from their value (extension fields resolve). Verified (`example-bob`).
- ⬜ **Document metadata editor** — the editor pointed at `hypermedia-metadata`.

### ▶ Redirect (2026-07-13): complete schema support in the **web app**, tested there
User: *"make sure the web app has complete support for the schema features.. run tests against web mostly."*

**Findings (mapped):** The pure schema core + editor form + registry hooks all live in `@shm/ui`
(shared). Web **already** gets the schema-aware *metadata* editor for free (via `DocumentMetadataView`
through `resource-page-common`'s `metadata` route). What web lacks is the **blob/schema *authoring*
surface** — the `raw-blob` route, `BlobSchemaEditor`, and the dev-mode "New Blob"/"New Schema" entries —
which were built **desktop-only** (v1 plan's own "out of scope": *"Web surface for the blob/schema editor"*).

**Feasibility: fully confirmed.** Web can `publish` blobs (universal client, used in `commenting`/`pending-intent`),
uses the same `useNavRoute`/`useNavigate` route model as desktop, already renders IPFS blobs read-only
via `WebInspectorPage`/`InspectIpfsPage` + a Remix route + `routeToHref` `inspect-ipfs` handling (the exact
pattern to mirror), `useCID`/`useSchemaRegistries` are universal-client based, and web has jsdom + `render`
test tooling. Desktop's `raw-blob.tsx` (587 lines) is ~95% shared-component glue.

**Plan (web-specific page, desktop untouched → zero regression risk to its 560 tests):**
- ✅ Baseline: web suite green — **126 passed, 1 skipped** (25 files, ~6s).
- ✅ **A. `web-raw-blob.tsx`** — desktop's raw-blob/schema editor ported to web: reuses every `@shm/ui`
  schema component (`BlobSchemaEditor`, `ValueEditor`, `BlobSchemaProvider`, validation), web navigation,
  `useSchemaRegistries`, web universal-client `publish`. Existing blob / new-instance / new-schema flows.
  Desktop untouched (zero regression risk). Typecheck clean.
- ✅ **D. Web tests (jsdom)** — `web-raw-blob.test.tsx`, **8 tests**, mirrors desktop's
  `raw-blob-schema-parity.test.tsx`: New Blob/New Schema render the same Publish + schema form; publish =
  one `PublishBlobs` with explicit sha256 CIDs + meta co-publish + route replace; plain-blob single-blob
  flow; new-instance seeds required fields → "Matches schema"; missing-required surfaces an advisory
  warning (kept as-is); meta-schema pinned-CID; `ipfsUrlToRoute` parsing. **Web suite: 134 passed, 1 skipped.**
- ✅ **B. Routing** — mirrors the inspector. `routeToHref` gains a `raw-blob` case → reserved
  `/hm/blob/{ipfs/<cid>|new-instance/<schemaCid>|new}` URLs (gateway form, so a site doc at `/blob`
  can't collide; no `@shm/shared`→`@shm/ui` dep). `$.tsx` loader detects those URLs
  (`extractRawBlobRouteFromPath`) → a `raw-blob` payload; the component renders
  `<WebSiteProvider initialRoute={route}><WebRawBlobPage/></WebSiteProvider>` (client-only, no server
  fetch). **+3 tests**: `routeToHref` ⇄ parser round-trip + non-blob fall-through. Web + shared typecheck clean.
- ✅ **C. Menu entry — enabled by default on web** *(per user: "web should just have this stuff enabled
  by default")*. Web's `UniversalAppProvider` now sets `experiments={{developerMode: true}}` (a module
  const `WEB_EXPERIMENTS`), so the building-block surfaces desktop hides behind a Developer-Mode toggle
  are always on for web. `WebResourcePage` merges `blobBuilderMenuItems(navigate)` ("New Blob" +
  "New Schema" = new instance of the meta-schema) into the document options menu. The helper lives in
  `web-raw-blob.tsx` (shared by menu + test). Merged into `optionsMenuItems` — **not** `extraMenuItems`,
  which resource-page-common only uses as a `??` fallback. **+1 test**: the entries navigate to
  `{key:'raw-blob'}` and `{key:'raw-blob', schemaCid: META}`.

### ▶ Iteration (2026-07-13): Inspector & Explorer integrated with the editor/viewer + Onyx
User: *"bring in the inspector and explorer features to support onyx and be fully integrated with the new
json editor and viewer. keep going until its all done!"* — iterative.

Two surfaces: the in-app **Inspector** (`InspectIpfsPage` + document inspector, read-only via the recursive
`DataViewer`) and the standalone **Explorer** app (`frontend/apps/explore`, its own `DataViewer`/`IPFS`/`api-lab`).

- ✅ **Iter 1 — Inspector ↔ editor + schema-awareness.** `InspectIpfsPage` now offers an **Edit** button
  (DAG-CBOR blob at its root → `raw-blob` editor), detects a **schema** blob (violet badge + **New Instance**
  → `raw-blob` schemaCid) and a **schema-attached** instance (badge), all via a pure, exported
  `inspectorBlobActions(cid, rawValue, isTopLevel)` reusing `isSchemaBlob`/`parseCidString`/`isDagJsonLink`.
  Works web + desktop (`useRouteLink` + the new `routeToHref` raw-blob case). **+5 ui tests**
  (`inspect-ipfs-page.test.ts`). ui suite 278, web 138, typecheck clean.
- ✅ **Iter 2 — Schema-aware validation in the inspector.** When an inspected blob carries an attached
  DAG-CBOR `schema` link, `InspectIpfsPage` fetches it (+ transitive refs) via `useSchemaRegistries` and
  advisory-validates the raw value with `validateValue` — the same warn-don't-block check the editor uses —
  showing **✓ Matches schema** or **⚠ N fields don't match — kept as-is**. The "Schema attached" badge is now
  a link into that schema's editor. `inspectorBlobActions` also returns `attachedSchemaCid` (**+1 test**,
  6 total). ui 279, web 138, typecheck clean.
- ✅ **Iter 3 — Explorer app schema-aware.** `frontend/apps/explore`'s `/ipfs/:cid` viewer now reuses the
  **same** shared helpers as the inspector — `inspectorBlobActions` (`@shm/ui/inspect-ipfs-page`) +
  `validateValue` + `useSchemaRegistries` — to badge schema blobs, advisory-validate instances against
  their attached schema (✓ matches / ⚠ N don't match), and link to the attached schema's own `/ipfs`
  page. One schema engine now backs the editor, the inspector, and the explorer. explore suite 11,
  typecheck clean. (Cross-app "Edit in Seed" deep-link from the standalone explorer → web editor left as
  a follow-up; it needs a configured web origin.)

**Inspector & Explorer: done** — both surfaces detect schemas and advisory-validate via the one `@shm/ui`
engine; the inspector additionally launches the editor (Edit / New Instance / open-schema).

### ▶ Follow-up phases (2026-07-13, via a 3-phase sequential **workflow** — one clean commit each)
User: *"use workflows and subagents to do all of these things … each phase as one commit."* Each phase =
one subagent that implemented → verified (typecheck + tests) → made exactly one commit. Independently re-verified.

- ✅ **Phase 1 — Document/IPFS inspector recognizes hypermedia (Onyx) blob types** (`417985a5f`). New pure
  `hypermediaBlobType(value)` (`@shm/ui/hypermedia-blob-type.ts`) → one of Comment/Change/Ref/Capability/
  Contact/Profile, only when `type` matches AND `signer`+`sig` are present (so JSON-Schema `{type:"object"}`
  never matches). "Onyx: <Type>" badge in the IPFS inspector. +tests. (Document `inspector-page.tsx` skipped
  by the agent — it renders reshaped payloads that drop the raw envelope, so recognition would be misleading.)
- ✅ **Phase 2 — Explorer "Edit in Seed" deep-link** (`cbc0e2e9a`). Pure `seedEditUrl(webOrigin, cid)` +
  `VITE_SEED_WEB_ORIGIN`; a Pencil "Edit in Seed" link on DAG-CBOR blobs → `<webOrigin>/hm/blob/ipfs/<cid>`. +tests.
- ✅ **Phase 3 — Onyx absorbs v1's value constraints + advisory validation** (`a9c0e8164`) — the reconciliation's
  first concrete step. `validate.mjs` now enforces `minLength`/`maxLength`/`pattern` (string),
  `minimum`/`maximum` (numbers), `minItems`/`maxItems` (list); invalid regex ignored; astral-safe length.
  Meta-schema variants (`onyx-scalar-schema`/`onyx-list-schema`) extended to permit + self-validate the
  keywords. Added `validateAdvisory` (warn-don't-block). `example-constrained.json` + harness cases;
  `schema-language.md` documents them; lockfile regenerated (92→93). `node validate.mjs` clean, `publish --check` ok.

**Verification (independent re-run):** @shm/ui **291**, explore **15**, web **138** + typecheck 0 errors,
schemas validator clean. Remaining reconciliation (evolve the app editor to be Onyx-backed; `@shm/onyx` TS
package; document-inspector typing) is future work.

**Net: web now has complete schema-feature support, on by default** — the schema-aware metadata editor
(already shared) + the blob/schema *authoring* editor (new), reachable from the document menu and via
`/hm/blob/…` URLs, all validated by the same `@shm/ui` engine. **Web suite: 138 passed, 1 skipped**
(was 126). Web + shared typecheck clean. Desktop untouched.
- ⬜ **Package** — extract the validator/editor into `@shm/onyx` (or reconcile with `@shm/ui`).
- ⬜ **Tour in HM** — schemas as HM documents; in-app Schema Explorer component (web + desktop);
  unify with the existing developer-mode schema UI.
- ⬜ Protocol/daemon/RPC phases — per [`onyx-integration-plan.md`](./onyx-integration-plan.md).

---

## 3 · Log

- **2026-07-13** — Cherry-picked 10 Onyx commits onto `feat/schemas`; created `onyx2`. Wrote the
  integration roadmap. Researched the frontend: found **Seed Blob Schema v1** (existing in-app
  schema system + editor). Raised the blocking Onyx-vs-v1 decision (§1). Build paused on it.
