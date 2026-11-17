---
name: Publish a folder
summary: How a directory of markdown files in a git repository and a Hypermedia space mirror each other without losing anything, and how to edit either side.
---
A Hypermedia [document](../protocol/documents.md) is a tree of typed [blocks](../protocol/blocks.md) with [annotations](../protocol/blocks.md) and [metadata](../metadata.md). Markdown has syntax for most of that and none for the rest. Repo HM sync keeps a directory of markdown files in a git repository and a Hypermedia [space](../protocol/spaces.md) in step. It uses the [markdown dialect](./markdown-dialect.md), which carries everything a document can hold. A document exported to a file and imported again is the same document, and a file exported from a document and re-exported is the same text. <!-- id:8v9H35RZ -->

The result is a [site](../protocol/sites.md) you can edit in two places: in git, with a pull request, and in the [Seed app](../software/desktop.md), with the editor. Either side can be the source of truth for a while, and the other side follows. <!-- id:FUrMW8hZ -->

# The files <!-- id:ypR-0GOe -->

Each file is one document in the [markdown dialect](./markdown-dialect.md). It looks like ordinary markdown and renders fine on GitHub. Every block ends with an HTML comment carrying its identity, `<!-- id:X -->`, and identity is what makes an edit an update of an existing block instead of a replacement. Frontmatter carries the document's metadata. Links between files of the directory are relative file links (`[Keys](./keys.md)`), which become `hm://` links to the corresponding documents when published.

A hand-written file needs none of the comments. A new file with no ids is matched to an existing document by position, so editing a paragraph in place updates that paragraph and does not replace the page. The ids appear the next time the document is exported.

# Export and import <!-- id:Qw6tZURQ -->

`space export` writes every document of a space into a directory: the home document as `index.md` and a document at `/a/b` as `a/b.md`. It only touches files whose content changed. Links between documents of the space become relative file links, so they work on GitHub too. <!-- id:FAMAD-7t -->

`space import` publishes a directory into a space. For each file it fetches the current document, diffs the blocks by id, and publishes a [change](../change.md) on the document's existing history. Unchanged documents produce no change at all, so running it repeatedly never spams [versions](../protocol/documents.md). <!-- id:Sgjo6URB -->

```sh <!-- id:v2HrI1rl -->
seed-cli space export hm://<uid> --dir ./site
seed-cli space import hm://<uid> --dir ./site --dry-run
seed-cli space import self --dir ./site
seed-cli space import self --dir ./site --check   # publish nothing while a file would violate its schema
```

`self` means the signing key's own space. The signing [key](./keys.md) comes from the vault or keyring, or from the environment, which is how CI signs: `SEED_CLI_KEYFILE` holds the contents of an unencrypted `.hmkey.json` exported from the app, or `SEED_CLI_MNEMONIC` holds a BIP-39 phrase. <!-- id:zcB4OI7D -->

A file renamed in git (`git mv`) keeps its block ids, so the import publishes a [move](../protocol/documents.md): a version [Ref](../ref.md) at the new path and a [redirect](../protocol/documents.md) at the old one. Nothing is imported while a relative link in the directory would break. A document that carries a [schema definition](../schema/typed-documents.md) travels with it. On export the schema [blob](../protocol/blobs.md) is written beside the page as `a/b.schema.json`, and `schemaDefinition` is left out of the page's frontmatter. On import the file is encoded back to [DAG-CBOR](../schema/encoding.md), published, and bound as the document's `schemaDefinition`. The schema file is the only source for it, so don't write `schemaDefinition` in frontmatter. <!-- id:xU_ABl-L -->

Two limits apply. The signing key must own the space: importing with a [delegated](../protocol/permissions.md) key is refused. And removing a file does not by itself unpublish its document.

# Editing in the app <!-- id:j-kcO6jR -->

`space dev` turns the desktop dev app into the editor for a directory. It creates a throwaway key under `.dev/` in the directory, registers it in the app's own [daemon](../software/daemon.md), publishes the directory there, and then watches the daemon. Every document you publish in the app is written straight back as a file, so `git diff` shows the edit within seconds. Only the dev app is watched. The production Seed app registers the same `hm://` scheme, so do not open the site from a link. The loop warns that an edit made there never reaches the directory. <!-- id:sRBhq3FC -->

While the loop runs, the app is the writer and git is where you commit. <!-- id:2YxRmFf1 -->

```sh <!-- id:cOirXqpn -->
seed-cli space dev --dir ./site
```

The loop talks to the dev app's API on `http://localhost:58004` and to its daemon on `http://localhost:58001` (both configurable with `--api` and `--daemon`), polls every two seconds, and also pushes files you change on disk while it runs (`--no-watch` to stop that, `--no-push` to skip the initial publish). The key lives in `<dir>/.dev/dev-key.mnemonic`, ignored by git, and is registered in the daemon under the name `hm-sync-<dirname>-<account tail>`. The accounts the directory has used are recorded in `<dir>/.dev/accounts.json` so that a regenerated key's stale dev site can be retired next time (`--keep-stale` leaves it). The dev daemon is a [peer](../protocol/network.md) like any other, so the dev site propagates to whatever network it is on. Use a development build of the app. <!-- id:zrY2vBSi -->

# A folder with a layout

A script can wrap these three commands with rules of its own: which file is the home document, which files stay out, what to check before publishing, and whether a document whose file is gone is retired. The Seed repository does this for the folder that is this site. [Editing these docs](../contribute/editing-these-docs.md) describes that layout and when it publishes.

# Who edits where

Run the dev loop and edit in the app, then commit the files it writes back. Documents published in the app that are not in the folder are pulled in on the next export. <!-- id:PW7O3ScJ -->

An agent that maintains a site should work in the git checkout and let the import publish, so every change is reviewed as a diff. If an agent edits the site directly (a [Seed Agents](../agent.md) [`write`](../agent/write.md) to `hm://…`), the next export brings the edit back into git. Both keep block ids, so neither loses the other's work. <!-- id:QVJJckLz -->

The import is ordinary `PublishBlobs` requests, so nothing here needs more than the [Seed API](./web-api.md). The CLI's `space-sync.ts` composes the SDK's dialect functions and block-diff helpers. <!-- id:H9mlTot0 -->

# See also <!-- id:tp-mbUCj -->

- [Seed CLI](./cli.md), for every flag of `space export`, `space import` and `space dev`. <!-- id:96NwUR-F -->
- [Markdown dialect](./markdown-dialect.md), for the syntax of the files.
- [Keys](./keys.md), for `key export` and the variables CI signs with. <!-- id:usory21u -->
- [Editing these docs](../contribute/editing-these-docs.md), for how the Seed repository publishes this site with these commands. <!-- id:l-NfNt5v -->
- [Documents](../protocol/documents.md) for what a change, a version and a redirect are <!-- id:OdJU2HjS -->
- [Hypermedia Schemas](../schema.md) for schema files beside pages <!-- id:5RnHi4tV -->
- [SDK](./sdk.md) <!-- id:4G3c4uc9 -->
