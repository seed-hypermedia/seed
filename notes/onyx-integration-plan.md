# Onyx integration plan

Bringing Onyx (the self-describing type system in `schemas/`) deep into the Seed
Hypermedia protocol and apps.

## North star

Onyx becomes the **single source of truth for Seed's data types**: schemas
published to IPFS, **referenced from signed blobs**, used for **runtime
validation in both TS and Go**, **code-generated into the TS type system**
(replacing the hand-written Zod in `hm-types.ts`), eventually **typing the RPC**,
and **browsable as first-class hypermedia documents** in the web and desktop apps.

## Where we are (done — on `feat/schemas`, `schemas/`)

- The type system: self-describing meta-schema (9 kinds, closed maps, `enum`,
  unions, extension/subtyping, **generics** `params`/`var`/`args`, `name`/`description`).
- `hm://` naming + authorities; **recursion via names** (not CIDs).
- Full schemafication of the six CBOR blob types (`backend/blob/`) — shared base +
  Change/Ref/Profile/Comment/Capability/Contact, the ops/block/annotation model,
  document metadata — plus the block layer (strict core union, open block,
  extension) and the `Change<Block>` **generic**.
- `validate.mjs` (257 checks, env-threaded generics), `publish.mjs` (deterministic
  DAG-CBOR CIDs → `schemas.lock.json`), `tour.mjs` (explorer).

## Guiding principles

1. **Two validators (TS + Go) must agree.** A shared **conformance test corpus**
   is the contract, not prose.
2. **Onyx validates; it does not coerce.** Zod does defaults/transforms; Onyx
   only validates. Normalization is a separate, explicit layer.
3. **Names on the wire, CIDs for pinning** — as designed. Don't rewrite refs to CIDs.
4. **Gradual, differential-tested migration** — never a big-bang replacement.
5. **Dogfood.** The schemas are themselves hypermedia documents.

---

## Phase 0 — Package & harden the core

Extract the reference impl into a real package the apps can import.

- `frontend/packages/onyx` (`@shm/onyx`): port `validate.mjs` → TS
  (`validate(schema, data, env)`, `resolveSchema`, generics), typed API.
- Schema **resolver**: `hm://` URL → schema. Bundle the schemas + `schemas.lock.json`
  into the package (~30 KB) for offline/embedded use; also support fetch-from-daemon.
- Keep `schemas/` as the spec + oracle. `publish.mjs --check` runs in CI.
- **Conformance corpus**: `schemas/conformance/*.json` = `{schema, data, valid}` cases,
  run by *both* the TS and (later) Go validators.

**Deliverable:** `import { validate } from "@shm/onyx"`; conformance suite green in CI.

## Phase 1 — Runtime validation of real blobs (prove parity)

- Wire the validator into the client decode path: when the app decodes a
  Change/Comment/Ref/… blob, validate it against its `hypermedia-*` schema.
  **Warn, don't reject** (observe first).
- **Differential-test against real data**: pull a corpus of real blobs from a
  daemon / fixtures; validate; reconcile every discrepancy. This surfaces the CBOR
  warts (legacy `iD`/`id` block keys, the comment sig-bug encoding, absent
  optionals) — fix the schemas to match reality or document the divergence.

**Deliverable:** Onyx validates 100% of a real blob corpus; a report of schema fixes.

## Phase 2 — Codegen: Onyx → TypeScript

- Generator in `@shm/onyx`: schemas → `hm-types.generated.ts`.
  - map→interface, list→`T[]`, scalar→primitive, `enum`→literal union,
    `anyOf`→discriminated union, extension→`interface extends`, ref→named type,
    open map (`values`)→index signature, `name`/`description`→JSDoc.
  - **generics map 1:1**: `params`→`<B = default>`, `var`→`B`, `args`→application.
    `Change<Block>` becomes a real TS generic.
- Pair with the validator for **parse-don't-validate**: `parse(schema, unknown): T`.

**Deliverable:** generated types that compile; a type-safe `parseBlock(unknown): HMBlock`.

## Phase 3 — Gradual replacement of `hm-types.ts` (Zod → Onyx)

Leaf-first, differential-tested, behind stable type re-exports.

- **3a** Generate types for the stable leaves (block types, metadata, the six
  blobs). `hm-types.ts` re-exports the generated types (no behavior change).
- **3b** Differential test: each Zod schema vs. its Onyx schema on shared fixtures.
- **3c** Replace Zod `.parse` with Onyx `validate`+`parse`, one type at a time.
- **3d** Retire the migrated Zod schemas.
- Handle Zod-only features (defaults, `transform`, coercion — e.g. `HMTimestamp`
  string|object, `File.size` number-from-string): add a **normalization layer** in
  `@shm/onyx`, or keep thin Zod adapters at the edges.

**Deliverable:** block/blob/metadata types in `hm-types.ts` are Onyx-backed.

## Phase 4 — Protocol: link schemas from signed blobs

The real protocol design. Open questions to settle with the team:

- **How a blob declares its schema.** Add `$schema` to the blob envelope. By
  **CID** (immutable, verifiable, pins the exact version) or **hm:// name**
  (mutable, human, versioned) or **both**? Leaning: carry the **CID** for
  verifiability, resolvable to a name via the manifest. Note `$schema` generalizes
  the existing `type` field (`type` = the schema's discriminator).
- **Backward compat.** Blobs without `$schema` → the current implicit mapping
  (`"Change"` → `hypermedia-change`, …). Old clients ignore `$schema`.
- **Where validation happens.** The **daemon** (Go) validates blobs against their
  schema on index — warn-only first, later quarantine/reject malformed blobs.
- **Publish schemas to the network.** The `hypermedia-*` schemas become real HM
  blobs under an authority (the `hyper.media` / `seed.hyper.media` pubkey), so
  they resolve by `hm://` on the network — not just in-repo. **Governance:** who
  owns/signs the schema authority; how updates are published.
- **Evolution & versioning** (hardest): rules for compatible change (add optional
  = ok; remove/rename = new version); how a blob pins a version; how validators
  handle newer unknown versions (the open/forward-compat design already helps);
  the migration story.

**Deliverable:** an RFC for `$schema` on blobs; a daemon prototype that warn-validates.

## Phase 5 — Go validator (daemon-side)

- Port Onyx to Go — the spec is small (~200 lines: kinds, closed maps, unions,
  extension, generics, env). Native Go is cleanest for the daemon.
- Run the **same conformance corpus** (Phase 0) → guaranteed TS/Go parity.
- Wire into the blob index (Phase 4).

**Deliverable:** `onyx.Validate` in Go passing the corpus; daemon warn-validates.

## Phase 6 — RPC typing

- The API is gRPC/proto (`backend/genproto`). Options: validate JSON/RPC payloads
  against Onyx schemas at the gateway; and/or generate Onyx schemas from (or
  alongside) proto. Start with the JSON API surface.

**Deliverable:** one RPC method's request/response Onyx-validated end to end.

## Phase 7 — The tour in HM documents & the apps

- Publish schemas as HM documents → the **tour becomes a hypermedia site** (each
  schema a document; deps/dependents are links). Browse it in the Seed app.
- Embed a **Schema Explorer** component in `frontend/apps/web` and
  `frontend/apps/desktop`: given an `hm://` schema URL, render the page we built
  (name/description, fields, dependencies, CID, source). *Types are documents* —
  clicking a type navigates to its schema.
- Unify with the **existing schema UI already on `feat/schemas`** (developer mode,
  schema-typed metadata fields, HM URL / Profile schema types): Onyx becomes the
  backing type system for those features.

**Deliverable:** an in-app schema viewer; the tour reachable as `hm://` documents.

---

## Cross-cutting risks

- **TS↔Go parity** → conformance corpus.
- **Validate-vs-coerce mismatch** with Zod → a normalization layer.
- **Schema evolution/versioning** → the hardest; needs its own spec (Phase 4).
- **Real-data warts** vs idealized schemas → surfaced by Phase 1 differential tests.
- **Authority governance** → who signs `hyper.media` schemas.
- **Perf** → validating every blob on index (cache resolved schemas).

## Suggested first slice (onyx2)

The smallest sequence that proves the whole thesis before touching the protocol:

1. **Phase 0** — `@shm/onyx` (TS validator + bundled schemas) + conformance corpus.
2. **Phase 1** — warn-validate real blobs client-side; reconcile schema vs. reality.
3. **Phase 2 (start)** — codegen the block types → TS; differential-test vs. the
   `HMBlock*` Zod schemas in `hm-types.ts`.

That demonstrates *Onyx validates real production data AND generates the TS types*,
which de-risks everything downstream.
