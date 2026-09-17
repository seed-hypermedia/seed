# hypermedia/: the Seed developer docs

This folder is the source of the Seed developer docs and the Hypermedia Schemas library. A commit to `main` publishes it to the Hypermedia network through `.github/workflows/sync-hypermedia.yml`. The home page of the published site is [index.md](./index.md). This README is not published.

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
| `rpc.md`, `rpc/` | the Seed API read methods as schemas, with the read models in `rpc/type/` |
| `example.md`, `example/` | example schemas and instances |
| `agent.md`, `agent/` | Seed Agents: reference pages, one page per term, the live roadmap and plans |
| `glossary.md` | one entry per term |
| `schemas.lock.json`, `schemas.aliases.json`, `pages.aliases.json` | not published: every schema's CID, old schema names that still resolve, and old page paths that redirect |

A `*.schema.json` beside a page is the schema that page defines. The sync encodes it to canonical DAG-CBOR, publishes it as a blob, and sets the page's `schemaDefinition` to `ipfs://<cid>` at publish time. Don't put `schemaDefinition` in frontmatter; `check.mjs` rejects it. A page without a schema can still be an instance of a type by naming one in `attributesSchema` in its frontmatter (see `example/bob.md`). How documents bind to schemas is explained in [Typed documents](./schema/typed-documents.md).

## Writing pages

- Frontmatter has a `name` (the title) and a `summary` (one whole sentence).
- Write for technical readers, but open each concept page with plain sentences and link every concept the first time it appears.
- No em-dashes, no filler, simple words. [Contributing](./build/contributing.md) has the details.
- Don't add `<!-- id:… -->` comments by hand. The sync assigns them.

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

```sh
pnpm hypermedia:push -- --dry-run   # what would change on hyper.media
pnpm hypermedia:push                # publish (signing key: main)
pnpm hypermedia:pull                # bring edits made in the Seed app back into git
./dev hm-sync                       # edit this folder in the desktop dev app
```

`push` checks every schema against the lockfile, publishes the schema blobs, then publishes each page. An existing document is updated block by block, and unchanged documents publish nothing. A page renamed in git publishes as a move. A document whose file is gone becomes a redirect when `pages.aliases.json` or `schemas.aliases.json` maps its old path to a live page, and is deleted otherwise. `--keep-stale` skips this. Nothing publishes while any relative link in the folder is broken.

`./dev hm-sync` (the `hm-sync` pane of `./dev up`) publishes the folder into the desktop dev app's daemon under a throwaway key in `hypermedia/.dev/`, and writes every document you publish in the app straight back to its file. While it runs, the app is the writer and git is where you commit. See [Publish a folder](./build/publish-a-folder.md).

## See also

- [index.md](./index.md), the published home page
- [Publish a folder](./build/publish-a-folder.md)
- [Hypermedia Schemas](./schema.md) and [Typed documents](./schema/typed-documents.md)
- [Contributing](./build/contributing.md)
