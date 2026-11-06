# hypermedia/: the Seed developer docs

This folder is the source of the Seed developer docs and the Hypermedia Schemas library. A commit to `main` publishes it to staging. A tagged Seed release publishes that release's `hypermedia/` tree to production through `.github/workflows/sync-hypermedia.yml`. Production `hyper.media` content must never be edited directly through the CLI, SDK, agents or UI. The home page of the published site is [index.md](./index.md). This README is not published.

Publishing to `staging.hyper.media` adds ` [STAGING]` to the home document's name (for example, `Hypermedia [STAGING]`). This happens during import, leaving `index.md` and all other page titles unchanged. Tagged production releases use the original name without the suffix.

The pages are markdown in the lossless dialect of `@seed-hypermedia/client` (`blocksToMarkdown` and `parseMarkdown`). Every block type, annotation, attribute and metadata key survives a round trip. Block ids ride in trailing `<!-- id:… -->` comments. Links between pages are relative `.md` links, so they work on GitHub and become `hm://` links when published.

## Layout

A page publishes at its path: `protocol/documents.md` is `/protocol/documents`. A folder's landing page sits beside the folder: `protocol.md` is the landing for `protocol/`.

| Path | What lives there |
| --- | --- |
| `index.md` | the home page |
| `why.md`, `why/` | why Hypermedia exists, for any reader |
| `protocol.md`, `protocol/` | the Hypermedia protocol, one page per concept |
| root pages | one page per blob or value type (`change`, `ref`, `capability`, `metadata`, `string`, `hm-url`…), each defining its schema |
| `block/`, `change/`, `ref/`, `contact/`, `metadata/`, `query/`, `blob/` | the detail types of a root page |
| `build.md`, `build/` | task guides: the Seed API, gRPC, the SDK, the CLI, agents, keys, sign-in, self-hosting, contributing |
| `apps.md`, `apps/` | one map page per piece of Seed software |
| `schema.md`, `schema/` | Hypermedia Schemas: the meta-schema, the chapters, one page per term |
| `example.md`, `example/` | example schemas and instances |
| `agent.md`, `agent/` | Seed Agents: reference pages, one page per term, the live roadmap and plans |
| `glossary.md` | one entry per term |
| `schemas.lock.json` | not published: every schema's CID |

A `*.schema.json` beside a page is the schema that page defines. The sync encodes it to canonical DAG-CBOR, publishes it as a blob, and sets the page's `schemaDefinition` to `ipfs://<cid>` at publish time. Don't put `schemaDefinition` in frontmatter; `check.mjs` rejects it. A page without a schema can still be an instance of a type by naming one in `attributesSchema` in its frontmatter (see `example/bob.md`). How documents bind to schemas is explained in [Typed documents](./schema/typed-documents.md).

The home icon is `assets/HyperMedia_IconInverse.png`, referenced by its `ipfs://` CID in `index.md` frontmatter. The release and dev sync upload that image alongside the schema blobs and reject a mismatched icon CID. When replacing the image, update the frontmatter to the CID reported by the sync's mismatch error.

## Writing pages

- Frontmatter has a `name` (the title) and a `summary` (one whole sentence).
- Write for technical readers, but open each concept page with plain sentences and link every concept the first time it appears.
- No em-dashes, no filler, simple words. [Contributing](./build/contributing.md) has the details.
- Don't add `<!-- id:… -->` comments by hand. The sync assigns them.
- The dev loop keeps existing Markdown byte-for-byte when its content, metadata and explicit identities already match the app. Starting the dev stack or pushing a file edit must not produce formatting-only diffs. Handwritten blocks without IDs are matched by position, including in files that already have IDs. An explicit `space export` from the isolated dev space still writes the canonical form; use it when you need persistent IDs for moving pages or linking to blocks.

## Checks and tools

```sh
node scripts/hypermedia/check.mjs            # everything below, run by CI before publishing
node scripts/hypermedia/validate.mjs         # the reference validator
node scripts/hypermedia/publish.mjs          # recompute schemas.lock.json after a schema change
node scripts/hypermedia/gen-registry.mjs     # the schema registry bundled into the SDK
node scripts/hypermedia/typegen.mjs          # TypeScript types for every schema
```

`check.mjs` fails when a schema is invalid, a schema has no page, the lockfile or generated files are stale, an instance page doesn't satisfy its type, or a page is missing a `name` or a whole `summary`. Page summaries feed the generated files, so run `gen-registry.mjs` and `typegen.mjs` after changing a summary on a schema page.

## Publishing

Production publication belongs exclusively to the tagged release workflow. Edit these source files and release them;
do not run a local production push or edit the production documents. Possession of the site key does not authorize a
write. A requested new URL such as `hyper.media/page` remains unpublished until the release containing its source.

```sh
pnpm hypermedia:push -- --dry-run   # read-only comparison; does not authorize a production push
./dev hm-sync                       # preview/edit in the isolated desktop dev space
```

Do not pull direct production edits into Git as the source of truth. The local dev loop may export edits from its
throwaway development space back into this folder.

The folder never names a key. Absolute links to the docs space and schema bindings in frontmatter use `hm://hyper.media/…`, and the layout's `selfAuthority` makes `push` swap `hyper.media` for the signing key's account and `pull` swap it back. Schema blobs publish unchanged. `hyper.media` is a name the SDK and the sync understand. The network does not resolve domains in `hm://` URLs yet (planned), so published documents carry the resolved key. `push` needs a signing key: `main`, `--key <name>`, or `SEED_CLI_KEYFILE` in CI. A dry run without a key takes `--space <uid>`.

`push` checks every schema against the lockfile, publishes the schema blobs, then publishes each page. An existing document is updated block by block, and unchanged documents publish nothing. A page renamed in git publishes as a move. A document whose file is gone is deleted. `--keep-stale` skips this. Nothing publishes while any relative link in the folder is broken.

`./dev hm-sync` (the `hm-sync` pane of `./dev up`) publishes the folder into the desktop dev app's daemon under a throwaway key in `hypermedia/.dev/`, and writes every document you publish in the app straight back to its file. While it runs, the app is the writer and git is where you commit. See [Publish a folder](./build/publish-a-folder.md).

You can switch branches while the launcher stays open. Sync pauses during Git operations or unresolved conflicts, then reconciles the dev site with the new checkout and resumes. File changes and app exports run in sequence, with checkout and content checks before publishing or writing. A checkout that removes the documentation directory pauses sync until the documents return. Both directions use the polling interval, so replacing directories does not lose a filesystem watcher. `--no-watch` deliberately disables reconciliation: on a branch change it pauses instead of exporting the old site into the new checkout.

## See also

- [index.md](./index.md), the published home page
- [Publish a folder](./build/publish-a-folder.md)
- [Hypermedia Schemas](./schema.md) and [Typed documents](./schema/typed-documents.md)
- [Contributing](./build/contributing.md)
