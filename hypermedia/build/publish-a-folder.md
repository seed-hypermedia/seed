---
name: Publish a folder
summary: How a directory of markdown files in a git repository and a Hypermedia space mirror each other without losing anything, how to edit either side, and how this documentation publishes itself.
---
A Hypermedia [document](../protocol/documents.md) is a tree of typed [blocks](../protocol/blocks.md) with [annotations](../protocol/blocks.md) and [metadata](../metadata.md). Markdown has syntax for most of that and none for the rest. Repo HM sync keeps a directory of markdown files in a git repository and a Hypermedia [space](../protocol/identity.md) in step. It uses a markdown dialect that carries everything a document can hold. A document exported to a file and imported again is the same document, and a file exported from a document and re-exported is the same text. <!-- id:8v9H35RZ -->

The result is a [site](../protocol/sites.md) you can edit in two places: in git, with a pull request, and in the [Seed app](../apps/desktop.md), with the editor. Either side can be the source of truth for a while, and the other side follows. <!-- id:FUrMW8hZ -->

# The dialect <!-- id:ypR-0GOe -->

Where markdown has syntax, the dialect uses it: headings, paragraphs, lists, block quotes, fenced code, math, images, links, tables, bold, italic, strikethrough and inline code all look like ordinary markdown and render fine on GitHub. <!-- id:maCi3cFf -->

Every block ends with an HTML comment carrying its identity, `<!-- id:X -->`. Identity is what makes an edit an update of an existing block instead of a replacement. Two optional keys ride in the same comment when markdown has no syntax for something: `type:` names a block type such as Video, File, Button, [Embed](../protocol/blocks.md) or [Query](../protocol/blocks.md), and `attrs:` holds a JSON object of attributes such as an image width or a query definition. A block with nothing special looks like plain markdown plus its id. <!-- id:1DcIkwWG -->

Nesting is indentation. A block's children sit two spaces deeper, or at the content column of a list marker. A heading's children follow it at the same indentation, and `<!-- end:X -->` closes a heading when a non-heading sibling follows. Frontmatter carries every metadata key of the document, including keys the client does not know about. <!-- id:2R3PHmZM -->

Text is escaped so that markdown syntax characters survive. Newlines inside a block are written as `<br>`. Style annotations that markdown lacks, such as underline, highlight and colors, are written as inline HTML tags. <!-- id:MqsUZbaE -->

A hand-written file needs none of the comments. A new file with no ids is matched to an existing document by position, so editing a paragraph in place updates that paragraph and does not replace the page. The ids appear the next time the document is exported. Links between files of the directory are relative file links (`[Keys](./keys.md)`), which render on GitHub and become `hm://` links to the corresponding documents when published. The dialect is implemented once, in the [SDK](./sdk.md). <!-- id:q0ZEm1qw -->

# Export and import <!-- id:Qw6tZURQ -->

`space export` writes every document of a space into a directory: the home document as `index.md` and a document at `/a/b` as `a/b.md`. It only touches files whose content changed. Links between documents of the space become relative file links, so they work on GitHub too. <!-- id:FAMAD-7t -->

`space import` publishes a directory into a space. For each file it fetches the current document, diffs the blocks by id, and publishes a [change](../change.md) on the document's existing history. Unchanged documents produce no change at all, so running it repeatedly never spams [versions](../protocol/documents.md). A hand-written file with no ids is matched to the existing document by position, so editing a paragraph in place updates that paragraph and does not replace the page. Relative links to other files in the directory become links to the corresponding documents. <!-- id:Sgjo6URB -->

```sh <!-- id:v2HrI1rl -->
seed-cli space export hm://<uid> --dir ./site
seed-cli space import hm://<uid> --dir ./site --dry-run
seed-cli space import self --dir ./site
seed-cli space import self --dir ./site --check   # publish nothing while a file would violate its schema
```

`--check`, and the `--no-watch` and `--keep-stale` flags of `space dev` below, are newer than the npm release of mid-September 2026 (0.2.9). See [Seed CLI](./cli.md). <!-- id:3FDgTtPD -->

`self` means the signing key's own space. The signing [key](./keys.md) comes from the vault or keyring, or from the environment, which is how CI signs: `SEED_CLI_KEYFILE` holds the contents of an unencrypted `.hmkey.json` exported from the app, or `SEED_CLI_MNEMONIC` holds a BIP-39 phrase. <!-- id:zcB4OI7D -->

A file renamed in git (`git mv`) keeps its block ids, so the import publishes a [move](../protocol/documents.md): a version [Ref](../ref.md) at the new path and a [redirect](../protocol/documents.md) at the old one. Nothing is imported while a relative link in the directory would break. A document that carries a [schema definition](../schema/typed-documents.md) travels with it. On export the schema [blob](../protocol/blobs.md) is written beside the page as `a/b.schema.json`. On import the file is encoded back to [DAG-CBOR](../schema/encoding.md), published, and bound as the document's `schemaDefinition`. Two limits apply as of September 2026. The signing key must own the space, and importing with a [delegated](../protocol/permissions.md) key is refused. Removing a file does not by itself unpublish the document (see the retire step below). <!-- id:xU_ABl-L -->

# Editing in the app <!-- id:j-kcO6jR -->

`space dev` turns the desktop dev app into the editor for a directory. It creates a throwaway key under `.dev/` in the directory, registers it in the app's own [daemon](../apps/daemon.md), publishes the directory there, and then watches the daemon. Every document you publish in the app is written straight back as a file, so `git diff` shows the edit within seconds. Only the dev app is watched. The production Seed app registers the same `hm://` scheme, so do not open the site from a link. The loop warns that an edit made there never reaches the directory. <!-- id:sRBhq3FC -->

While the loop runs, the app is the writer and git is where you commit. <!-- id:2YxRmFf1 -->

```sh <!-- id:cOirXqpn -->
seed-cli space dev --dir ./site
```

The loop talks to the dev app's API on `http://localhost:58004` and to its daemon on `http://localhost:58001` (both configurable with `--api` and `--daemon`), polls every two seconds, and also pushes files you change on disk while it runs (`--no-watch` to stop that, `--no-push` to skip the initial publish). The key lives in `<dir>/.dev/dev-key.mnemonic`, ignored by git, and is registered in the daemon under the name `hm-sync-<dirname>-<account tail>`. The accounts the directory has used are recorded in `<dir>/.dev/accounts.json` so that a regenerated key's stale dev site can be retired next time (`--keep-stale` leaves it). The dev daemon is a [peer](../protocol/network.md) like any other, so the dev site propagates to whatever network it is on. Use a development build of the app. <!-- id:zrY2vBSi -->

# How this documentation is published <!-- id:S9sJBMK0 -->

The folder `hypermedia/` in the Seed repository is this site. A small script in the CLI package, `sync-hypermedia.ts`, wraps `space import`, `space export` and `space dev` with the folder's layout: `index.md` is the home document, `README.md` stays on GitHub, every other `<x>.md` publishes at `/<x>`, and a `*.schema.json` beside a page is the schema that page defines. Before anything is published the script encodes every schema file and checks its [CID](../protocol/blobs.md) against `schemas.lock.json`, then publishes the schema blobs first. <!-- id:PtSuOMus -->

```sh <!-- id:MTYNMnUm -->
pnpm hypermedia:check                # offline consistency checks (schemas, lockfile, generated files, page names and summaries)
pnpm hypermedia:push -- --dry-run    # what would change on hyper.media: created, moved, updated, unchanged, retired
pnpm hypermedia:push                 # publish, signing with the `main` key
pnpm hypermedia:pull                 # bring edits made in the Seed app back into git
./dev hm-sync                        # the local editing loop; `./dev up` runs it as the hm-sync pane
```

From `frontend/apps/cli` the same commands are `bun run src/sync-hypermedia.ts push [--dry-run] [--server <url>] [--key <name>] [--keep-stale]`, `pull [--server <url>] [--space <uid>]` and `dev [--api <url>] [--daemon <url>] [--interval <ms>] [--no-push] [--no-watch] [--keep-stale]`. <!-- id:YT7XXn6B -->

**Retiring pages.** The folder is the truth about what the site publishes, so `push` also retires: every document of the site whose file is gone from the folder is [tombstoned](../protocol/documents.md) (the dry run lists them as `retire`). Redirects left behind by moves are kept, and the home document is never retired. `--keep-stale` skips the step. Delete a page in git and the next push removes it from the site. Rename it with `git mv` and the push publishes a move. <!-- id:VveGReog -->

**Pull.** `pull` exports every document of the site back into the folder, schema files included, and regenerates the lockfile and the bundled schema registry when a schema changed. When the dev loop starts it also compares the folder with hyper.media and warns when the public site is behind. <!-- id:oXXFJMx7 -->

**CI.** A push to `main` that touches `hypermedia/` runs the consistency checks and then the publish, signing with a repository secret that holds the contents of an exported `.hmkey.json` in `SEED_CLI_KEYFILE`. The site is that key's own space. <!-- id:6ZSmetkQ -->

# Working with it <!-- id:jkjEbVp5 -->

## In the Seed app <!-- id:SQhS12ol -->

Run the dev loop and edit in the app. Commit the files it writes back. Documents published in the app that are not in the folder are pulled in on the next export. <!-- id:PW7O3ScJ -->

## CLI <!-- id:VnNTczJ2 -->

Use `space export`, `space import` and `space dev`, plus `key export` for the CI key. [Seed CLI](./cli.md) lists every flag. <!-- id:jSB7Akp1 -->

## SDK <!-- id:fLZdm6QX -->

`blocksToMarkdown`, `parseMarkdown`, `flattenToOperations` and the block-diff helpers are the dialect and the diff. The CLI's `space-sync.ts` composes them. See [SDK](./sdk.md). <!-- id:zaB8S2em -->

## Web API <!-- id:q0SOQufN -->

The import is ordinary `PublishBlobs` requests. Nothing here needs more than the [Seed API](./web-api.md). <!-- id:H9mlTot0 -->

## Agents <!-- id:2zRDnAm1 -->

An agent that maintains a documentation site should work in the git checkout and let the push publish, so every change is reviewed as a diff. If an agent edits the site directly (a [Seed Agents](../agent.md) [`write`](../agent/write.md) to `hm://…`), the next `pull` brings the edit back into git. Both keep block ids, so neither loses the other's work. <!-- id:QVJJckLz -->

# See also <!-- id:tp-mbUCj -->

- [Seed CLI](./cli.md) <!-- id:96NwUR-F -->
- [Keys](./keys.md)
- [Contributing](./contributing.md)
- [Documents](../protocol/documents.md) for what a change, a version and a redirect are <!-- id:OdJU2HjS -->
- [Hypermedia Schemas](../schema.md) for schema files beside pages <!-- id:5RnHi4tV -->
- [SDK](./sdk.md)
