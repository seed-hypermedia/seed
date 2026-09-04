# hypermedia/ — a structure for the developer docs

Status: proposal, 2026-09-04. Branch `feat/onyx` (80 commits ahead of main; main still has the three-file `seed-docs/`).

## Where things stand

`hypermedia/` is one flat directory of 447 files. Counted by prefix:

| group                   | files                                                                                                             | what it is                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hypermedia-*`          | 59 pages + 59 schemas                                                                                             | the protocol's value types (blob, change, ref, document, block-_, op-_, query-\*, …)                                                                    |
| `seed-*`                | 66 pages + 66 schemas                                                                                             | the Seed server's JSON API types (`seed-rpc-*` calls, `seed-resource-*`, …)                                                                             |
| `example-*`, `sprout-*` | 38 pages + 38 schemas                                                                                             | worked examples for the Onyx docs; also `validate.mjs` fixtures                                                                                         |
| `onyx-*`                | 23 pages + 23 schemas                                                                                             | the Onyx type language itself (string, map, struct, schema, …)                                                                                          |
| `agent-*`, `agents.md`  | 43 pages                                                                                                          | Seed Agents (the Harness): ~18 durable reference pages, ~25 plans, reviews, build logs                                                                  |
| `permissions-system*`   | 7 pages                                                                                                           | a design investigation                                                                                                                                  |
| Onyx chapters           | 13 pages                                                                                                          | onyx, why, how-it-works, typed-documents, world-builder, api, data-model, schema-language, references, encoding, examples, hypermedia, design, glossary |
| site + tooling          | index, README, cli, repo-hm-sync; publish/typegen/validate/tour/editor-client scripts; schemas.lock.json; images/ |

Three problems, in order of pain:

1. **No structure.** Everything is a sibling. `document` means three different things (`hypermedia-document`,
   `seed-document`, `example-document`) and only the prefix says which. The home page is the only map.
2. **Whole layers are missing.** There is no page about the protocol itself: nothing on signing, blobs, Change/Ref,
   versions, capabilities, URLs, IPFS, p2p sync, sites. No CLI reference, no client SDK page, no REST or gRPC page, no
   self-hosting, no identity delegation, no app architecture, no contributing guide. That content exists, published on
   three other sites and scattered through the repo (inventory below).
3. **Reference and records are mixed.** Plans, reviews and build logs sit beside pages that must stay true. A reader
   cannot tell which pages are maintained.

## The structure

Three top-level directories, each with one rule:

```
hypermedia/
  index.md          the home page: what this site is, and the map
  README.md         GitHub-only: how the folder works (not published)
  doc/              maintained documentation. A page here is kept true; if it stops being true it is fixed or deleted.
  def/              definitions. One page per term of the vocabulary; the formal schema is attached when the term has one.
  log/              dated records: plans, proposals, reviews, postmortems, ADRs. Frozen at their date; never "updated", only superseded.
  images/
```

Published paths follow the files: `doc/protocol/urls.md` is `hm://<site>/doc/protocol/urls`. The generic space sync
already does this (`/a/b` ⇄ `a/b.md`); only the hypermedia-specific layout is flat.

### doc/

Organised by the reader's question, shallow (two levels), stable names.

```
doc/
  index.md                      the docs map (what to read for what)

  concepts/                     the mental model. Short pages, no wire detail, each linking to its def/ terms.
    accounts-and-keys           identity is a key; accounts, principals, profiles, the vault
    content-addressing          CIDs, blobs, IPFS, why nothing is ever overwritten
    resources-and-versions      a resource is a mutable value made of signed changes; versions, heads, refs
    documents-and-blocks        the block tree, metadata, paths, sub-documents
    links-and-urls              hm:// URLs, block references, web ↔ hm mapping
    capabilities-and-roles      who may write what; sites, members, delegation
    open-editing                branching and forking a document (git analogy)
    comments-and-discussions
    sites-and-hosting           a site is an account served on a domain

  protocol/                     what actually goes on the wire. The normative layer; every page cites def/ schemas.
    index                       the layers, from bytes to sites
    blobs                       signed DAG-CBOR blobs, the signing pattern (zero sig → encode → sign), BLAKE2B vs SHA256 CIDs
    documents                   Change, Ref, genesis, ops; how publishing a document works end to end
    versions                    the change DAG, heads, generations, tombstones, redirects
    capabilities                the Capability blob, roles, delegation chains
    comments                    Comment blobs, threads, comment URLs
    contacts-and-profiles
    urls                        the hm:// grammar (the normative version of the URL page)
    ipfs                        UnixFS files, blob storage, the /ipfs gateway path
    p2p                         libp2p, entity introductions, discovery, syncing (RBSR), bitswap, subscriptions
    sites                       hosting, /hm/ mapping, /.well-known, custom domains, redirects
    grpc                        the daemon API surface (proto/), how it is versioned
    rest-api                    the JSON API every seed-rpc-* type belongs to

  onyx/                         the type system. The current chapters, unchanged, moved.
    index (onyx.md), why, how-it-works, typed-documents, world-builder, api,
    data-model, schema-language, references, encoding, examples, hypermedia, design

  build/                        building on Hypermedia. The "interfaces" layer, as guides.
    getting-started             which entry point for which kind of builder (from hyper.media)
    cli                         the seed-cli reference (from CLI-REFERENCE.md / seed.hyper.media)
    client-sdk                  @seed-hypermedia/client: create/sign/publish blobs from TypeScript   (missing today)
    keys-and-signing            key derivation, keyrings, vault, signing from code (from cli/docs/KEYS.md, SIGNING.md)
    identity-delegation         hmauth: third-party sign-in with a session key (from docs/vault-session-key-delegation.md)
    agent-skill                 installing the Seed skills for Claude Code / Codex (from seed.hyper.media)
    self-hosting                run a node and a site on your own domain (from ops/README.md + seed.hyper.media)
    extensions                  the plugin system (feat/extensions)                                     (missing today)
    repo-hm-sync                a repo directory and a space that mirror each other (exists)
    docs-folder                 how this folder is published; the dev loop (from README.md + cli.md)

  agents/                       Seed Agents, the Harness. Durable reference only.
    index (agents.md), system-overview, development, environments, tools, signed-api,
    websocket-subscriptions, persistence, security, prompt-injection-map, operations,
    troubleshooting, mcp, model-providers, session-continuation, trigger-continuations,
    worker-isolated-execution, multi-server-architecture, desktop-ui

  apps/                         the software in this repo, one page per app, linking to deeper in-repo docs
    desktop                     data flow, document lifecycle, drafts, userData layout
    web                         SSR loading architecture, routing, /hm/ proxy
    notify                      the notification and email system
    editor                      the block editor
    mobile
    vault
    daemon                      the Go backend: storage, indexing, syncing (mostly missing today)

  contributing/
    dev-setup                   dev machine setup, ./dev, mprocs, worktrees
    testing                     unit / e2e / integration suites and how CI gates them
    releasing                   (from docs/releasing.md)
    local-ci                    (from docs/local-ci-with-agent-ci.md)
    agents-setup                coding-agent instructions layout (from docs/agent-setup.md)
    protocol-changes            how a protocol change is proposed and shipped (from seedteamtalks)
```

### def/

The glossary and the schema library become one thing: a page per term, with `<term>.schema.json` beside it when the term
has a formal shape. Today the Onyx site is exactly this for 186 terms; the seedteamtalks `/def/*` glossary (50 terms)
and `hypermedia/glossary.md`, `agent-glossary.md` are the same idea without schemas. Merge them.

```
def/
  index.md                      the glossary index (all terms, one line each; can be generated)
  <term>.md                     the Hypermedia protocol vocabulary — the unprefixed namespace
                                blob, change, ref, document, block, block-paragraph, …, op-*, query, capability, role,
                                comment, contact, profile, principal, signature, timestamp, cid, hm-url, ipfs, metadata,
                                visibility, annotation, navigation-item, …   (from hypermedia-*)
                                + schema-less terms: account, site, member, path, sub-document, version, genesis-change,
                                backlink, directory, discussion, feed, subscribe, search, entity-introduction,
                                rbsr-syncing, bitswap, gossip, unreferenced-document, …   (from seedteamtalks /def, glossary.md)
  onyx/<term>.md                the Onyx type language   (from onyx-*: string, map, struct, schema, union-schema, …)
  api/<term>.md                 the Seed server API types (from seed-*: rpc, rpc-list-comments, resource, document, …)
  example/<term>.md             worked examples          (from example-*, sprout-*)
  agents/<term>.md              the Harness vocabulary   (from agent-glossary.md: run, session, verb, tool, trigger, …)
```

Why the protocol vocabulary is the unprefixed one: this whole site is the Hypermedia developer docs, so `def/document`,
`def/change`, `def/capability` are what a reader expects to find, and it is exactly what seedteamtalks `/def/*` already
is. The Onyx primitives are a language _about_ those values, so they get a namespace; the API types are Seed's, not the
protocol's, so they get one too.

This reverses the earlier "clean primitives, prefixed rest" choice (`scripts/onyx-onify-refs.mjs`). The alternative —
keep that choice, just move files into `def/` with prefixes intact (`def/string`, `def/hypermedia-document`,
`def/seed-rpc`) — is a smaller change with the same URL break, see below. I recommend the namespaces.

### log/

```
log/
  index.md                      reverse-chronological list
  <area>/<slug>.md              displayPublishTime in frontmatter; the title says what it is (plan, review, postmortem, ADR)
```

Agents pages that move here: harness-plan, harness-build-log, harness-m6-event-bus-design, harness-review-01…05,
implementation-history, roadmap, future-projects, speed-plan, perf-squeeze-plan, pi-sdk-migration, triggers-plan,
workflows-v1-plan, write-tool-cli-parity-plan, write-tool-implementation-notes, hm-tables-markdown-plan,
desktop-agent-unification, desktop-assistant-write-plan, exec-warm-pool, model-comms-latency. The seven
`permissions-system*` pages move here as `log/protocol/permissions-*` (they are an investigation, dated). So do the
repo's ADRs and postmortems (below).

Whether `log/` should be published at all is a real question: seedteamtalks is where team records live today. The
argument for publishing here is that these records explain _why_ the reference says what it says, and the agents docs
already publish them. The argument against is noise for external readers. Recommendation: publish, but keep `log/` out
of the home page map and index it only from `log/index.md`.

## What to bring in

### From the repo (durable docs currently outside hypermedia/)

| source                                                                                                                                                      | →                             | notes                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `frontend/apps/cli/docs/CLI-REFERENCE.md`                                                                                                                   | doc/build/cli                 | 1.8k words; the real CLI reference. `hypermedia/cli.md` only covers the sync commands |
| `frontend/apps/cli/docs/KEYS.md`, `SIGNING.md`                                                                                                              | doc/build/keys-and-signing    | vault vs keyring, SLIP-10 derivation, signing code                                    |
| `frontend/apps/cli/docs/document-change-creation.md`                                                                                                        | doc/protocol/documents        | Go CreateDocumentChange explained + TS reimplementation; 2.9k words                   |
| `docs/vault-session-key-delegation.md`                                                                                                                      | doc/build/identity-delegation |                                                                                       |
| `ops/README.md`                                                                                                                                             | doc/build/self-hosting        | the deploy script and `seed-deploy` CLI; merge with seed.hyper.media's guide          |
| `vault/README.md`                                                                                                                                           | doc/apps/vault                |                                                                                       |
| `docs/releasing.md`, `docs/local-ci-with-agent-ci.md`, `docs/agent-setup.md`                                                                                | doc/contributing/\*           |                                                                                       |
| `docs/document-lifecycle-explained.md`                                                                                                                      | doc/apps/desktop              |                                                                                       |
| `frontend/apps/web/docs/ssr-loading-architecture.md`                                                                                                        | doc/apps/web                  |                                                                                       |
| `frontend/apps/notify/README.md` + `NOTIFICATIONS_*_ARCHITECTURE.md` (3)                                                                                    | doc/apps/notify               |                                                                                       |
| `proto/README.md`                                                                                                                                           | doc/protocol/grpc             |                                                                                       |
| `README.md` (root)                                                                                                                                          | doc/index + doc/apps          | the repo map                                                                          |
| `docs/document-collections-adr.md`, `docs/daemon-saturation-incident.md`, `docs/embed-rerender-postmortem.md`, `docs/comment-request-spam-investigation.md` | log/\*                        | ADRs and postmortems                                                                  |
| `docs/plans/*` (10), `docs/projects/*` (6), `docs/superpowers/{plans,specs}/*` (12), `notes/*` (7), `docs/*-plan.md`                                        | log/\*                        | only the ones still worth reading; the rest can stay where they are or be deleted     |
| `docs/blob-schemas/*` (6)                                                                                                                                   | delete or log/                | the v1 "Seed Blob Schema" that Onyx replaced (`notes/onyx-v1-migration-plan.md`)      |
| root-level `scratch.*.md`, `OVERNIGHT-PLAN.md`, `DEBUG_SESSION_SUMMARY.md`, `ci-optimization-log.md`, `*.html`, `frontend/apps/cli/cli-doc.md`              | delete                        | clutter, not docs                                                                     |

Not brought in: `AGENTS.md` files and `.agents/skills/` (instructions for coding agents, they stay next to the code);
`backend/util/llama-go/**` (vendored).

### From hyper.media (the protocol site, 52 pages, ~7.4k words)

This is the only published description of the protocol, and the docs folder has none of it. Rebuild, don't copy: most
pages are short (half are under 100 words), a few are good.

| page                                                                                            | words         | →                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| /protocol/links/hm-urls                                                                         | 648           | doc/protocol/urls (+ seedteamtalks def/hypermedia-url's grammar and reserved paths) |
| /how-to-start-building-on-the-hypermedia-protocol                                               | 539           | doc/build/getting-started                                                           |
| /protocol/resource, /data/change-resource, /data/document                                       | 454, 357, 436 | doc/concepts/resources-and-versions, doc/protocol/documents                         |
| /features/\* (open-editing, version-history, deep-references, community-archival, capabilities) | 150–380 each  | doc/concepts/\*                                                                     |
| /data/\* (change, ref, capability, comment, contact, profile, blob, signed-blob)                | mostly stubs  | absorbed by def/\* pages, which already have the schemas                            |
| /protocol/{entity-introductions, rpc, p2p, ipfs, site, grpc, account, version}                  | 25–260        | doc/protocol/{p2p, grpc, ipfs, sites}                                               |
| /interfaces/\*                                                                                  | stubs         | doc/build/\*                                                                        |
| /notes/why-not-activitypub                                                                      | 504           | log/protocol/why-not-activitypub                                                    |
| /concepts/_, /projects/_, /documentation-test                                                   | stubs         | drop                                                                                |

Once the docs folder covers this, hyper.media should point at it (or the site itself should be published from this
folder — a separate decision).

### From seedteamtalks.hyper.media (team site, 1,656 pages)

Mostly team records (notes 663, design 226, projects 225, meeting-notes 124, issues 67, updates 39) — not developer
docs. The parts that are:

| page                                                                                                                                                               | words    | →                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| /def/\* (50 terms; account, backlink, bitswap, capability, directory, gossip-protocol, hypermedia-url, join, member, profile, rbsr-syncing, site, sub-document, …) | 4–440    | def/\* — merged with the schema pages of the same name; schema-less terms become new def pages |
| /tech/developer-guide-how-publishing-a-document-works-in-seed                                                                                                      | 1,016    | doc/protocol/documents                                                                         |
| /tech/hypermedia-protocol-schemas, /tech/hypermedia-onyx, /tech/onyx-hm26, /tech/hm-26, /specs/onyx-wg                                                             | 90–790   | log/onyx/\* (the design history of Onyx)                                                       |
| /tech/linking                                                                                                                                                      | 395      | doc/protocol/urls (older `hm://d/` grammar; historical)                                        |
| /tech/document-block-types                                                                                                                                         | 230      | def/block\* pages                                                                              |
| /tech/desktop-data-flow, /tech/normalized-data-shape, /tech/query-api-and-persisted-queries                                                                        | 80–350   | doc/apps/desktop, doc/apps/web                                                                 |
| /tech/dev-machine-setup, /tech/how-to-locally-test-the-web-app, /tech/build-docker-seed-web-images                                                                 | 160–390  | doc/contributing/dev-setup, testing; doc/build/self-hosting                                    |
| /tech/seed-skills, /tech/agent-behavior, /tech/how-ion-works, /tech/ai-flows                                                                                       | 90–1,300 | doc/build/agent-skill, doc/agents/_, log/agents/_                                              |
| /tech/joinsubscribefollownotify, /specs/role-permissions-logic, /tech/modular-tools, /tech/flexible-schema-mentality                                               | 150–270  | doc/concepts/capabilities-and-roles; log/\*                                                    |
| /specs/_-protobuf-_ (6)                                                                                                                                            |          | doc/protocol/grpc — or generate from proto/                                                    |
| /methodologies/protocol-changes, /methodologies/glossary, /methodologies/software-development-methodology                                                          | 60–140   | doc/contributing/\*; def/index                                                                 |
| /specs/keyboard-shortcuts                                                                                                                                          | 116      | doc/apps/desktop                                                                               |

### From seed.hyper.media (product site, 108 pages)

User-facing; only the technical resources belong here:

| page                                                                                                 | words   | →                                                       |
| ---------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| /resources/cli                                                                                       | 2,160   | doc/build/cli (compare with CLI-REFERENCE.md; keep one) |
| /resources/installing-seed-skills-for-ai-agents, /resources/seed-and-ai-agents, …/agent-guide        | 230–980 | doc/build/agent-skill, doc/agents/index                 |
| /resources/self-host-seed                                                                            | 441     | doc/build/self-hosting                                  |
| /resources/how-to-add-a-custom-domain-to-your-seed-hypermedia-site                                   | 317     | doc/protocol/sites or doc/build/self-hosting            |
| /community/hypermedia-comment-urls, /community/how-to-branch-a-document                              | 270–490 | doc/protocol/comments, doc/concepts/open-editing        |
| /resources/hierarchy-and-navigation-organization-guide, design guide, sharing guide, blog, community |         | stay (product docs)                                     |

### Missing everywhere (to write)

- doc/build/client-sdk — `@seed-hypermedia/client`: the signed-blob creation pattern, publishBlobs, CID hashing gotcha
  (BLAKE2B in Go vs SHA256 in TS), hmauth.
- doc/protocol/blobs — signing and encoding, normative.
- doc/protocol/rest-api — the prose around the 66 `seed-*` types.
- doc/build/extensions — the plugin system.
- doc/apps/daemon — storage, indexing, sync, the SQLite schema.
- doc/contributing/testing — which suites exist, what PR CI actually runs.
- def/index and log/index.

## What moves where (current → new)

| current                                                                                                                                                                                                        | new                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `index.md`, `README.md`, `images/`                                                                                                                                                                             | unchanged                                          |
| `hypermedia-<x>.md` + `.schema.json`                                                                                                                                                                           | `def/<x>.md` + `.schema.json`                      |
| `onyx-<x>.md` + `.schema.json`                                                                                                                                                                                 | `def/onyx/<x>.md` + `.schema.json`                 |
| `seed-<x>.md` + `.schema.json`                                                                                                                                                                                 | `def/api/<x>.md` + `.schema.json`                  |
| `example-<x>.md`, `sprout-resource.md` + schemas                                                                                                                                                               | `def/example/<x>.md` + `.schema.json`              |
| `glossary.md`, `agent-glossary.md`                                                                                                                                                                             | split into `def/*`, `def/agents/*`; `def/index.md` |
| `onyx.md`, `why.md`, `how-it-works.md`, `typed-documents.md`, `world-builder.md`, `api.md`, `data-model.md`, `schema-language.md`, `references.md`, `encoding.md`, `examples.md`, `hypermedia.md`, `design.md` | `doc/onyx/{index,why,…}.md`                        |
| `agents.md` + 18 durable `agent-*`                                                                                                                                                                             | `doc/agents/{index,…}.md`                          |
| 25 `agent-*` plans/reviews/logs                                                                                                                                                                                | `log/agents/*.md`                                  |
| `permissions-system*.md`                                                                                                                                                                                       | `log/protocol/permissions-*.md`                    |
| `cli.md`, `repo-hm-sync.md`                                                                                                                                                                                    | `doc/build/{docs-folder,repo-hm-sync}.md`          |
| `publish.mjs`, `typegen.mjs`, `validate.mjs`, `tour.mjs`, `editor-client.js`, `schemas.lock.json`                                                                                                              | unchanged location; made recursive (below)         |

Renames publish as moves (the importer emits a redirect for a page renamed in git), so every old page URL keeps working.

## Tooling changes

1. `frontend/apps/cli/src/sync-hypermedia.ts` — `layout` becomes the default layout plus "README.md is not published";
   drop `publicName`/`basenameForPublicName` (no more `onyx-` stripping). `loadSchemaBlobs` walks `def/` recursively and
   keys the lockfile by path (`hm://<site>/def/onyx/string`).
2. `hypermedia/publish.mjs`, `typegen.mjs`, `validate.mjs`, `scripts/gen-onyx.mjs`, `scripts/gen-onyx-site.mjs` —
   recursive over `def/`; the bundle key becomes the path (`def/onyx/schema`), and the ~40 hardcoded basenames in
   `frontend/packages/ui/src/onyx/**` and `frontend/packages/client/src/**` (`'onyx-schema'`, `'hypermedia-blob'`,
   `'seed-rpc'`, …) follow.
3. **Schema URLs are the breaking change.** 186 schema files embed `hm://<site>/<name>` references (336 to `/string`
   alone). Moving a schema page changes its URL, which changes every referencing schema's bytes, which changes every
   CID: a full re-lock and republish. `scripts/onyx-onify-refs.mjs` already does exactly this kind of rewrite; extend it
   with the new mapping. The engine's bundled-URL resolution (`onyx-engine.ts`) must resolve the new URLs; anything on
   the network conforming to an old URL (world-builder demos, dev data) breaks unless the resolver follows document
   redirects — check that before publishing. This is cheapest now: `feat/onyx` is unmerged and main has no `hypermedia/`
   at all.
4. `.github/workflows/sync-hypermedia.yml` — unchanged.
5. `docs/`, `notes/` in the repo: after the move, leave a one-line README pointing at `hypermedia/`.

## Steps

1. Decide the three open questions: namespaces vs prefixes in `def/`; publish `log/` or not; whether hyper.media becomes
   this folder.
2. Tooling: make the schema scripts and the sync layout path-based and recursive; add a `--check` that fails on a broken
   relative link (the importer already refuses to publish one).
3. Move: `git mv` by group; rewrite schema refs; re-lock; regenerate bundle and types; run `validate.mjs`,
   `typegen.mjs --check`, the onyx unit tests, `pnpm typecheck`.
4. Split the glossaries into `def/` pages; write `def/index.md`; merge seedteamtalks `/def` prose into the pages of the
   same name.
5. Bring in the repo docs (table above), one commit per page, editing as they land rather than pasting.
6. Rebuild `doc/concepts` and `doc/protocol` from hyper.media + seedteamtalks + `document-change-creation.md`; write the
   missing pages.
7. Home page and `doc/index.md` as the map; remove the old `docs/` files that moved.
