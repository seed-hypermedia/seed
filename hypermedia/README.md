# hypermedia/ — the Seed developer docs

This folder is the source of truth for the documentation that Seed publishes to
the Hypermedia network: the developer docs, the **Onyx** schema library (every
`*.schema.json` with its co-located `*.md`), and the **Agents** docs
(`agent-*.md`, `agents.md`). It is one flat directory; a commit to `main`
publishes it (`.github/workflows/sync-hypermedia.yml`), and the Seed app is the
editor (see below).

The markdown is the lossless dialect of `@seed-hypermedia/client`
(`blocksToMarkdown` / `parseMarkdown`): every block type, annotation, attribute
and metadata key survives a round trip, block ids ride in trailing
`<!-- id:… -->` comments, and links between pages are relative file links, so
they work on GitHub and become `hm://` links when published. Start at
[index.md](./index.md), the home page of the published site.

## Layout

| file | published at |
| --- | --- |
| `index.md` | the home document |
| `onyx-<x>.md` (+ `onyx-<x>.schema.json`) | `/<x>` — primitives and meta-schemas keep their public names |
| `<x>.md` (+ optional `<x>.schema.json`) | `/<x>` |
| `README.md` | not published |
| `images/` | assets referenced by pages; uploaded as blobs when published |

A `*.schema.json` beside a page is the schema that page **defines**: it is
encoded to canonical DAG-CBOR, published as a blob, and bound to the document
as `schemaDefinition: ipfs://<cid>`. A `{$type, value}` file is an instance
instead: its document conforms to `$type`. `schemas.lock.json` pins every
schema's CID (`node hypermedia/publish.mjs --check`), and
`scripts/gen-onyx.mjs` bundles the schemas into the app.

## Syncing

```sh
pnpm hypermedia:push -- --dry-run   # what would change on hyper.media
pnpm hypermedia:push                # publish to the Onyx site (signing key: main)
pnpm hypermedia:pull                # bring edits made in the Seed app back into git
./dev hm-sync                       # the local editing loop; `./dev up` runs it as the hm-sync pane
```

`push` verifies every schema against the lockfile, publishes the schema blobs,
then publishes each page as a document. A document that already exists is
updated in place, block by block; unchanged documents publish nothing; a page
renamed in git is published as a move. Nothing is published while a link in
the folder would break. `pull` writes every document of the site back here,
schema JSON included. The dev loop (`frontend/apps/cli/src/utils/dev-loop.ts`)
publishes the folder into the desktop dev app's daemon under a throwaway key
(`hypermedia/.dev/`, gitignored), opens the site in the dev app, and writes
every document you publish there straight back, so `git diff` shows your edit
within seconds. While it runs the app is the writer and git is where you
commit. See [repo-hm-sync.md](./repo-hm-sync.md) and [cli.md](./cli.md).

---

# Onyx

**A self-describing type system for content-addressed data — and how Seed
documents bind to it.** [onyx.md](./onyx.md) is the published guide; the
reference chapters are [data-model.md](./data-model.md),
[schema-language.md](./schema-language.md), [references.md](./references.md),
[encoding.md](./encoding.md), [examples.md](./examples.md),
[hypermedia.md](./hypermedia.md), [design.md](./design.md) and
[glossary.md](./glossary.md). What follows is the engineering detail behind
them.

## TypeScript types

`typegen.mjs` generates a TS type for every schema
(`frontend/packages/client/src/onyx-types.generated.ts`): maps become object
types, enums literal unions, `anyOf` unions, extension intersection, and
`params`/`var`/`args` real TS generics (`Change<Block>`). Regenerate with
`node hypermedia/typegen.mjs`; `--check` fails if it's out of date. This is Phase 2 of
the integration plan — the schemas, not hand-written Zod, become the source of
the app's types.

---

## How a document binds to a schema

Onyx types the *values*. This section is how a **Hypermedia document** declares
what it is. A document may carry three distinct schema-related metadata fields —
all declared on the **base document** schema
([`hypermedia-document.json`](./hypermedia-document.schema.json)):

| field | meaning | value |
| --- | --- | --- |
| **`schema`** | the schema **this** document conforms to | a schema-doc `hm://` URL, or `ipfs://<cid>` |
| **`childrenSchema`** | the schema this document's **children** must conform to | a schema-doc `hm://` URL, or `ipfs://<cid>` |
| **`schemaDefinition`** | this document **defines/describes** a schema (so others reference it by URL) | `ipfs://<cid>` of a schema blob |

The last one was the biggest early misunderstanding: **`schemaDefinition` does
NOT mean "this document conforms to a schema."** A document that *describes* a
type (e.g. a "Person" doc at `hm://acme/person`) sets `schemaDefinition` to the
person schema blob. Another document *conforms* by setting `schema:
hm://acme/person` — which resolves through that doc's `schemaDefinition` to the
actual schema. A **value** (an employee record like "bob") is not a type: it sets
`schema`, never `schemaDefinition`.

**Base document.** Every typed document schema **extends**
`hm://z6MkmZUb…/hypermedia-document` — a map of `{ metadata, content }` where
`content` is the block-node tree ([`hypermedia-block-node.json`](./hypermedia-block-node.schema.json))
and `metadata` is [`hypermedia-metadata.json`](./hypermedia-metadata.schema.json) (which
carries the three fields above). A typed schema refines the nested `metadata`
(e.g. requires an extra field) — see [`example-person-doc.json`](./example-person-doc.schema.json),
which requires `metadata.surname`.

**Child inheritance.** A document's **effective** conformance schema is its own
`schema`, or — if absent — its parent's `childrenSchema`. A child that declares
its own `schema` must descend from the base document **and** the parent's
`childrenSchema`.

**References everywhere.** A schema reference (`schema`, `childrenSchema`, an
`extends` ref, a map-property or list-item subschema) can be an ipfs CID, a
bundled library URL (`hm://z6MkmZUb…/map`, resolved locally), or an arbitrary
Hypermedia document URL (`hm://acct/path`, fetched → that doc's
`schemaDefinition` → the blob).

**Worked example** (the model end-to-end):
1. A schema blob extends `hm://z6MkmZUb…/hypermedia-document` and requires a
   `surname` in `metadata`.
2. `hm://acme/person` describes what a person is and sets `schemaDefinition` to
   that CID — now "person" has a URL.
3. `hm://acme/people` sets `childrenSchema: hm://acme/person`.
4. Every child (`hm://acme/people/bob`) conforms; at the top of both the Content
   and Attributes tabs, the required `surname` field is always visible.

**Errors are guardrails, not gates.** Out-of-spec metadata/content surfaces as
**red, non-blocking** UI (which field, what rule) — the user can always still
save invalid content.

The full design + phased implementation notes live in
[`../notes/onyx-schema-model-v2.md`](../notes/onyx-schema-model-v2.md).

---

## In the Seed app

The type system is ported into the app (`frontend/packages/ui/src/onyx/`) so
schema-authoring, browsing, and validation never disagree with the reference
validator:

- **Engine** (`onyx-engine.ts`) — a TS port of [`validate.mjs`](./validate.mjs);
  bundles every schema + the CID manifest; resolves a CID or `hm://` URL to a
  schema with no fetch when it's bundled.
- **Resolution** (`onyx-schema-resolve.tsx`) — `useResolvedSchema` (CID /
  bundled URL / fetched document URL) and `useEffectiveDocSchema` (own `schema`
  else parent `childrenSchema`).
- **Required attributes** — the conformance schema's required custom fields are
  always-visible editable rows, at the top of the **Attributes** tab and **above
  the body** in the **Content** tab; they can't be removed.
- **Red validation** — a per-field badge + a summary banner flag out-of-spec data.
- **Schema-definition documents** get a header **tag** that opens the schema and
  a **Create** button that opens the schema-defined value editor and publishes a
  new IPFS blob.
- **Explorer / data editor** — browse any schema and build a conforming value
  (the published documents are the catalog; any schema opens at `/hm/schema/<cid>`).

