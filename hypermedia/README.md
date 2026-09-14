# hypermedia/ — the Seed developer docs

This folder is the source of truth for the documentation that Seed publishes to
the Hypermedia network: the Hypermedia concepts, the **Hypermedia Schemas** schema library
(every `*.schema.json` with its co-located `*.md`), the API, the examples, the
developer docs and the **Agents** docs. A commit to `main` publishes it
(`.github/workflows/sync-hypermedia.yml`), and the Seed app is the editor (see
below).

The markdown is the lossless dialect of `@seed-hypermedia/client`
(`blocksToMarkdown` / `parseMarkdown`): every block type, annotation, attribute
and metadata key survives a round trip, block ids ride in trailing
`<!-- id:… -->` comments, and links between pages are relative file links, so
they work on GitHub and become `hm://` links when published. Start at
[index.md](./index.md), the home page of the published site.

## Layout

Every page publishes at its path: `<path>.md` (with an optional
`<path>.schema.json` beside it) is `/<path>`, so `block/image.md` is
`/schema/block/image`. A folder's landing page sits beside the folder
(`schema.md` is `/schema`, the meta-schema and the home of `schema/`).

| path | what lives there |
| --- | --- |
| `index.md` | the home document |
| root pages | the essential Hypermedia concepts (`change`, `ref`, `document`, `block`, `cid`, `authority`, …), the value types (`string`, `map`, `link`, `any`, `date`, `url`, `hm-url`, `ipfs-url`, …), and `schema`, the meta-schema, which is also the landing of `schema/`, plus the landings `schema`, `rpc`, `example` and `agent` |
| `schema/` | the schema language: the meta-schema variants, its chapters, one page per term |
| `block/`, `change/`, `query/`, `ref/`, `blob/`, `metadata/`, `contact/` | the detail types of a concept live beside it: the block model in `block/`, the ops in `change/op/`, the query language in `query/`, … |
| `rpc/` | the Seed read API: one page per method, `rpc/method` (the union of them), and the read models in `rpc/type/` |
| `example/` | the example schemas and instances, flat |
| `doc/` | developer docs: publishing, the schema project's narrative (`doc/schema/`), the permissions investigation (`doc/permissions/`) |
| `agent/` | the Agents docs: reference pages and one page per term, `plans/`, `history/`, `images/` |
| `README.md` | not published |
| `schemas.lock.json`, `schemas.aliases.json` | not published: every schema's CID, and the names schemas had before this layout |

A `*.schema.json` beside a page is the schema that page **defines**: it is
encoded to canonical DAG-CBOR, published as a blob, and bound to the document
as `schemaDefinition: ipfs://<cid>`. A `{$type, value}` file is an instance
instead: its document conforms to `$type`. `schemas.lock.json` pins every
schema's CID (`node scripts/hypermedia/publish.mjs --check`),
`schemas.aliases.json` keeps references to a schema's old name resolving, and
`scripts/hypermedia/gen-registry.mjs` bundles the schemas into the app. The schema tools
(validate, publish, typegen, the tour) live in `scripts/hypermedia/`.

## Syncing

```sh
pnpm hypermedia:push -- --dry-run   # what would change on hyper.media
pnpm hypermedia:push                # publish to the Hypermedia site (signing key: main)
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
commit. See [repo-hm-sync.md](./doc/repo-hm-sync.md) and [cli.md](./doc/cli.md).

---

# Hypermedia Schemas

**A self-describing type system for content-addressed data — and how Seed
documents bind to it.** [schema.md](./schema.md) is the published guide; the
reference chapters are [data-model.md](./schema/data-model.md),
[schema-language.md](./schema/schema-language.md), [references.md](./schema/references.md),
[encoding.md](./schema/encoding.md), [example.md](./example.md),
[blobs.md](./schema/blobs.md) and [design.md](./doc/schema/design.md), and
every term has its own page (listed under Terms in [schema.md](./schema.md)).
What follows is the engineering detail behind them.

## TypeScript types

`scripts/hypermedia/typegen.mjs` generates a TS type for every schema
(`frontend/packages/client/src/schema-types.generated.ts`): maps become object
types, literals literal types, `anyOf` unions, extension intersection, and
`params`/`var`/`args` real TS generics (`Change<Block>`). Regenerate with
`node scripts/hypermedia/typegen.mjs`; `--check` fails if it's out of date. This is Phase 2 of
the integration plan — the schemas, not hand-written Zod, become the source of
the app's types.

---

## How a document binds to a schema

Hypermedia Schemas type the *values*. This section is how a **Hypermedia document** declares
what it is. A document may carry three distinct schema-related metadata fields —
all declared on the base document's [`metadata`](./metadata.schema.json):

| field | meaning | value |
| --- | --- | --- |
| **`attributesSchema`** | the attributes schema **this** document conforms to | a schema-doc `hm://` URL, or `ipfs://<cid>` |
| **`childAttributesSchema`** | the attributes schema this document's **children** conform to | a schema-doc `hm://` URL, or `ipfs://<cid>` |
| **`schemaDefinition`** | this document **defines/describes** a schema (so others reference it by URL) | `ipfs://<cid>` of a schema blob |

The last one was the biggest early misunderstanding: **`schemaDefinition` does
NOT mean "this document conforms to a schema."** A document that *describes* a
type (e.g. a "Person" doc at `hm://acme/person`) sets `schemaDefinition` to the
person schema blob. Another document *conforms* by setting `attributesSchema:
hm://acme/person` — which resolves through that doc's `schemaDefinition` to the
actual schema. A **value** (an employee record like "bob") is not a type: it sets
`attributesSchema`, never `schemaDefinition`.

**Attributes, not documents.** An attributes schema is a plain struct of the
fields a document's metadata carries — see [`example/person-doc.json`](./example/person-doc.schema.json),
which requires `surname`. It does not extend the base document and does not
mention `metadata` or `content`: a typed document is still a full document with a
body; the schema only types its attributes. When a document is checked, the base
[`metadata.json`](./metadata.schema.json) fields (name, summary, icon, the three
binding keys, …) are folded in beneath the type's fields, and the result stays
open to extra keys.

**Child inheritance.** A document's **effective** attributes schema is its own
`attributesSchema`, or — if absent — its parent's `childAttributesSchema`. A child
that declares its own `attributesSchema` is expected to satisfy the parent's
`childAttributesSchema` as well.

**References everywhere.** A schema reference (`attributesSchema`,
`childAttributesSchema`, an `extends` ref, a map-property or list-item subschema)
can be an ipfs CID, a bundled library URL (`hm://z6MkmZUb…/schema/map`, resolved
locally), or an arbitrary Hypermedia document URL (`hm://acct/path`, fetched →
that doc's `schemaDefinition` → the blob).

**Worked example** (the model end-to-end):
1. A schema blob is a struct that requires a `surname`.
2. `hm://acme/person` describes what a person is and sets `schemaDefinition` to
   that CID — now "person" has a URL.
3. `hm://acme/people` sets `childAttributesSchema: hm://acme/person`.
4. Every child (`hm://acme/people/bob`) conforms; at the top of both the Content
   and Attributes tabs, the required `surname` field is always visible.

**Errors are guardrails, not gates.** Out-of-spec metadata/content surfaces as
**red, non-blocking** UI (which field, what rule) — the user can always still
save invalid content.

The full design + phased implementation notes live in
[`../notes/schema-model-v2.md`](../notes/schema-model-v2.md).

---

## In the Seed app

The type system is ported into TypeScript in `@seed-hypermedia/client`
(`frontend/packages/client/src/schema-*.ts` and `signed-blob.ts`), shared by the app, the CLI and the
agents service, so schema-authoring, browsing, validation and signing never
disagree with the reference validator or with each other:

- **Engine** (`schema-engine.ts`) — a TS port of [`validate.mjs`](../scripts/hypermedia/validate.mjs);
  bundles every schema + the CID manifest; resolves a CID or `hm://` URL to a
  schema with no fetch when it's bundled.
- **Resolver** (`schema-resolve.ts`) — a reference (bundled URL, CID, or a type
  document's URL) to its schema, over the network when needed, with every
  nested reference fetched into a registry; and a document's effective schema.
- **Signed blobs** (`signed-blob.ts`) — the envelope, the signing rule
  (canonical CBOR with `sig` zeroed), publishing.
- **CLI** (`frontend/apps/cli`) — `schema get|validate`, `blob get|validate|create|sign|verify`,
  `document validate`, `document create|update --metadata|--attributes-schema|--child-attributes-schema|--schema-definition`,
  `space import --check`; see [user stories](./doc/schema/user-stories.md).

In the app (`frontend/packages/ui/src/schema/`):
- **Resolution** (`schema-resolve.tsx`) — `useResolvedSchema` (CID /
  bundled URL / fetched document URL) and `useEffectiveDocSchema` (own `attributesSchema`
  else parent `childAttributesSchema`).
- **Required attributes** — the conformance schema's required custom fields are
  always-visible editable rows, at the top of the **Attributes** tab and **above
  the body** in the **Content** tab; they can't be removed.
- **Red validation** — a per-field badge + a summary banner flag out-of-spec data.
- **Schema-definition documents** get a header **tag** that opens the schema and
  a **Create** button that opens the schema-defined value editor and publishes a
  new IPFS blob.
- **Explorer / data editor** — browse any schema and build a conforming value
  (the published documents are the catalog; any schema opens at `/hm/schema/<cid>`).

