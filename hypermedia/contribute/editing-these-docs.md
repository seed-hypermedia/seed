---
name: Editing these docs
summary: This page explains how the hypermedia/ folder of the Seed repository becomes this site, which rules a page must follow, which checks to run, how to edit locally, and when a change is published.
---
These docs are the `hypermedia/` folder of the Seed repository. Each markdown file becomes one [document](../protocol/documents.md) on the published [site](../protocol/sites.md). So to change a page, you edit a file and open a pull request.

The folder is published the same way any folder can be, as [Publish a folder](../build/publish-a-folder.md) describes. This page covers what is special about this folder: its layout, the rules that the checks enforce, how to edit it locally, and where a merged change goes. `hypermedia/README.md` in the repository holds the same rules for people who read on GitHub.

# The folder <!-- id:FUbEfrIK -->

A page is plain markdown with a `name` and a one-sentence `summary` in the frontmatter. Links between pages are relative `.md` links. The [markdown dialect](../build/markdown-dialect.md) keeps everything when a page goes to the [Seed app](../software/desktop.md) and back. <!-- id:N8dBXosg -->

A small script in the [CLI](../software/cli.md) package, `frontend/apps/cli/src/sync-hypermedia.ts`, wraps `space import`, `space export` and `space dev` with the layout of this folder: <!-- id:PtSuOMus -->

- `index.md` is the [home document](../protocol/spaces.md).
- `README.md` stays on GitHub.
- Every other `<x>.md` is published at `/<x>`.
- A `*.schema.json` beside a page is the [schema](../schema.md) that the page defines.
- The landing page of a folder sits beside the folder. So `protocol.md` is the landing page of `protocol/`.

Before it publishes anything, the script encodes every schema file and checks its [CID](../cid.md) against `schemas.lock.json`, the [lockfile](../schema/library-pipeline.md). Then it publishes the schema [blobs](../protocol/blobs.md) first.

# Rules when you edit <!-- id:i7YPkwE2 -->

- Nothing is published while a relative link is broken. So fix links in the same commit that moves or removes a page. `check.mjs` finds a broken link with the same code the publish uses, so a pull request fails on it. <!-- id:au3AMFtl -->
- Nothing is published while a page has no parent page, or while a parent has no [Card embed](../block/embed-view.md) of a child. A new folder needs its landing page beside it. `node scripts/hypermedia/tree.mjs --fix` adds the missing cards to the end of each parent. Move them into the right group afterwards. <!-- id:tR3eRu1e -->
- A page that uses a term from the [glossary](../glossary.md) or the [agents glossary](../agent/glossary.md) links the page that defines it. The two glossaries are the list of terms, so a new concept needs an entry there. `check.mjs` fails when a link is missing.
- When you rename a file in git, the publish moves the document and leaves a [redirect](../protocol/documents.md) at the old address. <!-- id:Xz4P0KgA -->
- When you delete a file, the next push deletes its document, unless the push runs with `--keep-stale`. The document gets a [tombstone](../protocol/documents.md), which marks it as deleted. Redirects left by moves are kept, and the home document is never deleted. <!-- id:n5piDq7x -->
- A page with a `*.schema.json` beside it defines a schema. Keep its path, and let `check.mjs` confirm the lockfile and the generated types. Do not write `schemaDefinition` in the frontmatter. The schema file is its only source. <!-- id:NE-QyORm -->
- Keep the `<!-- id:… -->` comments on the lines you keep. They are [block](../protocol/blocks.md) ids. A new page needs none, and you never add one by hand. <!-- id:1y4a34hH -->
- An absolute reference to the docs [space](../protocol/spaces.md) uses `hm://hyper.media/…`. Examples are a schema binding in the frontmatter and a link in an example. The folder never names the space it is published to.

You can send a correction as a pull request, or as a [comment](../protocol/comments.md) on the published page. <!-- id:KCHxO4zQ -->

# Checks and commands

```sh <!-- id:cKaIfLAn -->
node scripts/hypermedia/check.mjs          # schemas, lockfile, generated types, bindings, frontmatter, tables, the tree rule, glossary links, broken links
node scripts/hypermedia/tree.mjs --fix     # add the Card embed of each child that a parent lacks
node scripts/hypermedia/concepts.mjs --fix # link the first mention of each glossary term a page uses
pnpm hypermedia:push -- --dry-run          # read-only: what a publish would create, update, move or retire
./dev hm-sync                              # edit the folder in the desktop dev app and write edits back
```

`check.mjs` (also `pnpm hypermedia:check`) fails in these cases:

- A schema is invalid, or a schema has no page.
- The lockfile or the generated files are out of date.
- A page that is an instance of a type does not fit its type.
- A page has no `name`, or its `summary` is not a whole sentence.
- A page has no parent page, or a parent has no Card embed of a child.
- A table row has a different number of cells than its header.
- A page names a glossary term without linking the page that defines it.
- A link points at a page or a file that the folder does not publish. This is the offline part of the publish itself (`bun run src/sync-hypermedia.ts preflight` in `frontend/apps/cli`), so it needs `bun`.

The summaries of schema pages go into the generated files. So after you change the summary of a schema page, run `node scripts/hypermedia/gen-registry.mjs` and `node scripts/hypermedia/typegen.mjs`.

The sync commands run from `frontend/apps/cli`: <!-- id:YT7XXn6B -->

- `bun run src/sync-hypermedia.ts push [--dry-run] [--server <url>] [--key <name>] [--keep-stale]`
- `bun run src/sync-hypermedia.ts pull [--server <url>] [--space <uid>]`
- `bun run src/sync-hypermedia.ts dev [--api <url>] [--daemon <url>] [--interval <ms>] [--no-push] [--no-watch] [--keep-stale]`

A dry run without a key needs `--space <uid>`.

# The editing loop

`./dev hm-sync` lets you edit the docs in the desktop app. `./dev up` runs it as the `hm-sync` pane. It does two things:

- It publishes the folder into the [daemon](../software/daemon.md) of the desktop development app, under a throwaway key in `hypermedia/.dev/`.
- It writes every document that you publish in the app straight back to its file.

While it runs, you write in the app and you commit in git. [Publish a folder](../build/publish-a-folder.md) describes the loop in full.

The loop leaves a markdown file exactly as it is when its content, metadata and block ids already match the app. So starting the stack does not produce diffs that only change formatting. You can switch branches while it runs. The sync pauses during a git operation or while a conflict is open. Then it brings the development site in line with the new checkout and continues.

# When a change is published

The workflow `.github/workflows/sync-hypermedia.yml` publishes the folder to two sites. Each site is the space of its own key. The keys are repository secrets. Each secret holds the contents of an exported `.hmkey.json`, and the workflow gives it to the script as `SEED_CLI_KEYFILE`. No key is written in the repository. <!-- id:6ZSmetkQ -->

| Target | When | Site | Secret |
| --- | --- | --- | --- |
| staging | every merge to `main` that touches `hypermedia/` | `staging.hyper.media` | `SEED_DOCS_STAGING_KEYFILE` |
| production | a release tag, as the last job of the `Release - Docker Images` workflow | `hyper.media` | `SEED_DOCS_KEYFILE` |

The workflow runs `check.mjs` first, and it publishes nothing when the check fails. Both release workflows also run `check.mjs` as their first job, and they build nothing when it fails. On staging, the name of the home document gets the suffix ` [STAGING]` when it is published.

Production content comes only from a tagged [release](./releasing.md):

- The workflow refuses a production run that does not come from a tag.
- Do not push to production from your own machine.
- Do not edit the production documents through the app, the [CLI](../build/cli.md) or an [agent](../agent.md). Having the site key does not change that.

So a new page shows on staging after its merge, and on `hyper.media` after the next release.

**Naming.** The layout sets `selfAuthority` to `hyper.media`. `push` replaces it with the [account](../protocol/identity.md) of the signing key, in page links and in every `hm://` string in the frontmatter. `pull` puts `hyper.media` back. So in git an `attributesSchema` says `hm://hyper.media/example/person`, and on the published site it says `hm://<key>/example/person`. Schema blobs keep `hm://hyper.media` unchanged, so their CIDs match the lockfile. `hyper.media` is a name that the [SDK](../build/sdk.md) and the sync understand. The network does not look up domains in `hm://` URLs. <!-- id:MCPA2cIg -->

**Pull.** `pull` exports every document of a site back into the folder, with the schema files. When a schema changed, it also builds the lockfile and the bundled schema registry again. Git is the source of truth for production. So use `pull` only to bring back edits that you made in a development space. <!-- id:oXXFJMx7 -->

# See also

- [Publish a folder](../build/publish-a-folder.md), the general round trip between a directory and a space.
- [Markdown dialect](../build/markdown-dialect.md), the syntax of the files.
- [Hypermedia Schemas](../schema.md), for the schema files beside pages.
- [Releasing](./releasing.md), which publishes the folder to production.
- [Contributing](./contributing.md), for the rest of the repository.
