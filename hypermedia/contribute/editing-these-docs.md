---
name: Editing these docs
summary: How the hypermedia/ folder of the Seed repository becomes this site, the rules a page must follow, the checks to run, the local editing loop, and when a change is published.
---
This site is the `hypermedia/` folder of the Seed repository. Each markdown file is one [document](../protocol/documents.md), and the folder is published with the same round trip any folder can use, described in [Publish a folder](../build/publish-a-folder.md). This page covers what is specific to this folder: its layout, the rules the checks enforce, the editing loop, and where a merged change goes. `hypermedia/README.md` in the repository holds the same rules for people reading on GitHub.

# The folder <!-- id:FUbEfrIK -->

Pages are plain markdown with a `name` and a one-sentence `summary` in the frontmatter. Links between pages are relative `.md` links. The [markdown dialect](../build/markdown-dialect.md) round-trips losslessly through the [Seed app](../software/desktop.md). <!-- id:N8dBXosg -->

A small script in the CLI package, `frontend/apps/cli/src/sync-hypermedia.ts`, wraps `space import`, `space export` and `space dev` with the folder's layout: `index.md` is the home document, `README.md` stays on GitHub, every other `<x>.md` publishes at `/<x>`, and a `*.schema.json` beside a page is the [schema](../schema.md) that page defines. A folder's landing page sits beside the folder, so `protocol.md` is the landing page of `protocol/`. Before anything is published the script encodes every schema file and checks its [CID](../protocol/blobs.md) against `schemas.lock.json`, then publishes the schema blobs first. <!-- id:PtSuOMus -->

# Rules when you edit <!-- id:i7YPkwE2 -->

- Nothing publishes while any relative link is broken, so fix links in the same commit that moves a page. <!-- id:au3AMFtl -->
- Nothing publishes while a page has no parent page, or a parent has no Card embed of a child. A new folder needs its landing page beside it, and `node scripts/hypermedia/tree.mjs --fix` adds the missing cards to the end of each parent. Move them into the right group afterwards. <!-- id:tR3eRu1e -->
- Renaming a file in git publishes a move with a [redirect](../protocol/documents.md) at the old address. <!-- id:Xz4P0KgA -->
- Deleting a file retires its document on the next push, unless the push runs with `--keep-stale`. The document is [tombstoned](../protocol/documents.md). Redirects left by moves are kept, and the home document is never retired. <!-- id:n5piDq7x -->
- A page with a `*.schema.json` beside it defines a [schema](../schema.md). Keep its path, and let `check.mjs` confirm the lockfile and generated types. Do not write `schemaDefinition` in frontmatter. The schema file is its only source. <!-- id:NE-QyORm -->
- Keep the `<!-- id:… -->` comments on lines you keep. They are [block](../protocol/blocks.md) ids. New pages need none, and you never add one by hand. <!-- id:1y4a34hH -->
- Absolute references to the docs space, such as schema bindings in frontmatter and links in examples, use `hm://hyper.media/…`. The folder never names the space it publishes to.

Corrections are welcome as pull requests, or as [comments](../protocol/comments.md) on the published page. <!-- id:KCHxO4zQ -->

# Checks and commands

```sh <!-- id:cKaIfLAn -->
node scripts/hypermedia/check.mjs          # schemas, lockfile, generated types, bindings, frontmatter, the tree rule
node scripts/hypermedia/tree.mjs --fix     # add the Card embed of each child that a parent lacks
pnpm hypermedia:push -- --dry-run          # read-only: what a publish would create, update, move or retire
./dev hm-sync                              # edit the folder in the desktop dev app and write edits back
```

`check.mjs` (also `pnpm hypermedia:check`) fails when a schema is invalid, a schema has no page, the lockfile or generated files are stale, an instance page does not satisfy its type, a page is missing a `name` or a whole `summary`, a page has no parent page, or a parent has no Card embed of a child. Page summaries feed the generated files, so run `node scripts/hypermedia/gen-registry.mjs` and `node scripts/hypermedia/typegen.mjs` after changing a summary on a schema page.

From `frontend/apps/cli` the sync commands are `bun run src/sync-hypermedia.ts push [--dry-run] [--server <url>] [--key <name>] [--keep-stale]`, `pull [--server <url>] [--space <uid>]` and `dev [--api <url>] [--daemon <url>] [--interval <ms>] [--no-push] [--no-watch] [--keep-stale]`. A dry run without a key needs `--space <uid>`. <!-- id:YT7XXn6B -->

# The editing loop

`./dev hm-sync`, which `./dev up` runs as the `hm-sync` pane, publishes the folder into the desktop dev app's [daemon](../software/daemon.md) under a throwaway key in `hypermedia/.dev/`, and writes every document you publish in the app straight back to its file. While it runs, the app is the writer and git is where you commit. [Publish a folder](../build/publish-a-folder.md) describes the loop in full.

The loop keeps existing markdown byte for byte when its content, metadata and block ids already match the app, so starting the stack does not produce formatting-only diffs. You can switch branches while it runs. Sync pauses during git operations or unresolved conflicts, then reconciles the dev site with the new checkout and resumes.

# When a change is published

The workflow `.github/workflows/sync-hypermedia.yml` publishes the folder to two sites, each the [space](../protocol/spaces.md) of its own key. The keys are repository secrets that hold the contents of an exported `.hmkey.json`, passed to the script as `SEED_CLI_KEYFILE`. No key is written in the repository. <!-- id:6ZSmetkQ -->

| Target | When | Site | Secret |
| --- | --- | --- | --- |
| staging | every merge to `main` that touches `hypermedia/` | `staging.hyper.media` | `SEED_DOCS_STAGING_KEYFILE` |
| production | a release tag, as the last job of the `Release - Docker Images` workflow | `hyper.media` | `SEED_DOCS_KEYFILE` |

The workflow runs `check.mjs` first and publishes nothing when it fails. On staging the home document's name gets the suffix ` [STAGING]` at publish time. The workflow refuses a production run that does not come from a tag. Production content comes only from a tagged [release](./releasing.md): do not push to production from a laptop, and do not edit the production documents through the app, the CLI or an agent. Holding the site key does not change that. A new page is therefore visible on staging after its merge and on `hyper.media` after the next release.

**Naming.** The layout sets `selfAuthority` to `hyper.media`. `push` swaps it for the signing key's account in page links and in every `hm://` string in frontmatter, and `pull` swaps the key back. So in git an `attributesSchema` says `hm://hyper.media/example/person`, and on the published site it says `hm://<key>/example/person`. Schema blobs keep `hm://hyper.media` unchanged, so their CIDs match the lockfile. `hyper.media` is a name the SDK and the sync understand. The network does not resolve domains in `hm://` URLs. <!-- id:MCPA2cIg -->

**Pull.** `pull` exports every document of a site back into the folder, schema files included, and regenerates the lockfile and the bundled schema registry when a schema changed. Git is the source of truth for production, so `pull` is for bringing back edits made in a development space. <!-- id:oXXFJMx7 -->

# See also

- [Publish a folder](../build/publish-a-folder.md), the general round trip between a directory and a space.
- [Markdown dialect](../build/markdown-dialect.md), the syntax of the files.
- [Hypermedia Schemas](../schema.md), for the schema files beside pages.
- [Releasing](./releasing.md), which publishes the folder to production.
- [Contributing](./contributing.md), for the rest of the repository.
