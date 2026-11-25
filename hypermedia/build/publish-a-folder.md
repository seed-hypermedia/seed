---
name: Publish a folder
summary: This guide shows how a folder of markdown files in a git repository and a Hypermedia space stay the same without losing anything, and how to edit on either side.
---
Folder sync keeps two things the same: a folder of markdown files in a git repository, and a Hypermedia [space](../protocol/spaces.md). Each file is one [document](../protocol/documents.md). You can publish the folder into the space, and you can write the space back into the folder. <!-- id:8v9H35RZ -->

Nothing is lost on the way. A document is a tree of typed [blocks](../protocol/blocks.md) with [annotations](../protocol/blocks.md) and [metadata](../metadata.md). Plain markdown can say most of that, but not all. So the files use the [markdown dialect](./markdown-dialect.md), which can hold everything a document holds. A document written to a file and read back is the same document.

The result is a [site](../protocol/sites.md) you can edit in two places: in git, with a pull request, and in the [Seed app](../software/desktop.md), with the editor. You can work on either side for a while, and the other side follows. <!-- id:FUrMW8hZ -->

# The files <!-- id:ypR-0GOe -->

Each file is one document in the [markdown dialect](./markdown-dialect.md). It looks like normal markdown and shows well on GitHub. Three things are special:

- **Block ids.** Every block ends with an HTML marker that holds its id, `<!-- id:X -->`. The id tells the import that you edited an existing block. Without it, the import would see a new block that replaces the old one.
- **Frontmatter.** The lines between `---` at the top hold the document's metadata.
- **Links.** A link from one file to another is a relative file link, such as `[Keys](./keys.md)`. When you publish, it becomes an `hm://` link to the matching document.

A file you write by hand needs no markers. The import matches its blocks to the existing document by position. So if you edit a paragraph in place, the import updates that paragraph and does not replace the page. The ids appear in the file the next time you export the document.

# Export and import <!-- id:Qw6tZURQ -->

Two commands move content between the space and the folder.

**`space export` writes a space into a folder.** <!-- id:FAMAD-7t -->

- The home document becomes `index.md`. A document at `/a/b` becomes `a/b.md`.
- It only writes files whose content changed.
- Links between documents of the space become relative file links, so they work on GitHub too.

**`space import` publishes a folder into a space.** For each file it does three things: <!-- id:Sgjo6URB -->

1. It fetches the current document.
2. It compares the blocks by id.
3. It publishes a [change](../change.md) on top of the document's history.

A document that did not change gets no new change. So you can run the import again and again without making new [versions](../protocol/documents.md).

```sh <!-- id:v2HrI1rl -->
seed-cli space export hm://<uid> --dir ./site
seed-cli space import hm://<uid> --dir ./site --dry-run
seed-cli space import self --dir ./site
seed-cli space import self --dir ./site --check   # publish nothing while a file would violate its schema
```

`self` means the space of the signing key. The CLI finds the signing [key](./keys.md) in one of two places: <!-- id:zcB4OI7D -->

- the Seed app's local key store or the keyring of your operating system;
- the environment, which is how a CI job signs. `SEED_CLI_KEYFILE` holds the contents of an unencrypted `.hmkey.json` exported from the app. `SEED_CLI_MNEMONIC` holds a BIP-39 phrase. Set only one.

The import also handles these cases: <!-- id:xU_ABl-L -->

- **A renamed file.** A file renamed in git (`git mv`) keeps its block ids. So the import publishes a [move](../protocol/documents.md): a version [Ref](../ref.md) at the new path and a [redirect](../protocol/documents.md) at the old path.
- **A broken link.** The import publishes nothing while a relative link in the folder points at a file that does not exist.
- **A schema.** A document that carries a [schema definition](../schema/typed-documents.md) keeps it. On export, the CLI writes the schema [blob](../protocol/blobs.md) beside the page as `a/b.schema.json` and leaves `schemaDefinition` out of the page's frontmatter. On import, it encodes the file back to [DAG-CBOR](../schema/dag-cbor.md), publishes it, and sets it as the document's `schemaDefinition`. The schema file is the only source, so do not write `schemaDefinition` in frontmatter.

Two limits apply:

- The signing key must own the space. The import refuses a [delegated](../protocol/permissions.md) key.
- Removing a file does not remove its document from the space.

# Editing in the app <!-- id:j-kcO6jR -->

`space dev` lets you edit a folder in the Seed app. It works with a development build of the desktop app, not the production app. <!-- id:sRBhq3FC -->

```sh <!-- id:cOirXqpn -->
seed-cli space dev --dir ./site
```

The command does four things:

1. It creates a throwaway key under `.dev/` in the folder.
2. It registers that key in the dev app's own [daemon](../software/daemon.md).
3. It publishes the folder there.
4. It watches the daemon. Every document you publish in the app is written back as a file, so `git diff` shows the edit within seconds.

While the loop runs, the app is where you write and git is where you commit. <!-- id:2YxRmFf1 -->

Only the dev app is watched. The production Seed app opens the same `hm://` links, so do not open the dev site from a link. An edit you make in the production app never reaches the folder, and the loop warns you about this.

The details: <!-- id:zrY2vBSi -->

- The loop talks to the dev app's API on `http://localhost:58004` and to its daemon on `http://localhost:58001`. Change them with `--api` and `--daemon`.
- It checks for changes every two seconds (`--interval <ms>`).
- It also publishes files you change on disk while it runs. `--no-watch` stops that. `--no-push` skips the first publish.
- The key is in `<dir>/.dev/dev-key.mnemonic`, which git ignores. The daemon holds it under the name `hm-sync-<dirname>-<account tail>`.
- The [accounts](../protocol/identity.md) the folder has used are listed in `<dir>/.dev/accounts.json`. If the key is made again, the loop uses this list to retire the old dev site. `--keep-stale` leaves it.
- The dev daemon is a [peer](../protocol/network.md) like any other. So the dev site spreads to whatever network that daemon is on.

# A folder with a layout

A script can wrap these three commands and add rules of its own: which file is the home document, which files stay out, what to check before publishing, and whether a document is retired when its file is gone. The Seed repository does this for the folder that is this site. [Editing these docs](../contribute/editing-these-docs.md) describes that layout and when it publishes.

# Who edits where

**A person.** Run the dev loop and edit in the app. Then commit the files it writes back. Documents that were published in the app but are not in the folder come in with the next export. <!-- id:PW7O3ScJ -->

**An agent.** An agent that maintains a site should work in the git checkout and let the import publish. Then every change is reviewed as a diff. An agent can also edit the site directly, for example a [Seed Agents](../agent.md) agent that uses [`write`](../agent/write.md) on an `hm://` address. The next export brings that edit back into git. Both ways keep block ids, so neither loses the other's work. <!-- id:QVJJckLz -->

The import sends ordinary `PublishBlobs` requests, so it needs nothing more than the [Seed API](./web-api.md). In the CLI, `space-sync.ts` puts the SDK's dialect functions and block-compare helpers together. <!-- id:H9mlTot0 -->

# See also <!-- id:tp-mbUCj -->

- [Seed CLI](./cli.md), for the flags of `space export`, `space import` and `space dev`. <!-- id:96NwUR-F -->
- [Markdown dialect](./markdown-dialect.md), for the syntax of the files.
- [Keys](./keys.md), for `key export` and the variables CI signs with. <!-- id:usory21u -->
- [Editing these docs](../contribute/editing-these-docs.md), for how the Seed repository publishes this site with these commands. <!-- id:l-NfNt5v -->
- [Documents](../protocol/documents.md) for what a change, a version and a redirect are <!-- id:OdJU2HjS -->
- [Hypermedia Schemas](../schema.md) for schema files beside pages <!-- id:5RnHi4tV -->
- [SDK](./sdk.md) <!-- id:4G3c4uc9 -->
