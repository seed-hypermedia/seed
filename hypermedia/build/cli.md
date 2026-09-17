---
name: Seed CLI
summary: The seed-cli reference, from install and signing keys through every command group and flag, with the commands this documentation folder is published with.
---
The Seed CLI (`seed-cli`) reads and writes the Hypermedia network from a terminal. It signs everything locally with an Ed25519 key you hold, talks to any Seed web server over the [Seed API](./web-api.md), and prints documents as markdown you can edit and send back. It is also the scripting surface for agents: a Claude Code session with the seed-cli skill runs exactly these commands.

# Install

```sh
npx -y @seed-hypermedia/cli --help        # run without installing
npm install -g @seed-hypermedia/cli       # or install; provides `seed-cli` and `seed-hypermedia`
```

Node 18 or newer. The package is a single bundle with the [SDK](./sdk.md) inside; CI publishes a new patch version on every push to `main` that touches it, so `npx …@latest` is always current. From a checkout, `bun run src/index.ts …` in `frontend/apps/cli` runs it from source, and `./dev install-cli` links it.

# Global options

| Option | Meaning |
| --- | --- |
| `-s, --server <url>` | the Seed web server to talk to (default `https://hyper.media`) |
| `--dev` | development environment: `https://dev.hyper.media` plus the dev keyring and vault; cannot be combined with `--server` |
| `--json`, `--yaml` | structured output (`--md`, the markdown default, is accepted but changes nothing) |
| `--pretty` | colourised JSON or YAML, or markdown rendered for the terminal |
| `-q, --quiet` | one tab-separated line per item, no status messages |
| `--vault <path>` | a desktop or daemon `vault.json` to read identities from (default: auto-detect) |
| `-V, --version`, `-h, --help` | |

The server is resolved in this order: `--dev`, `--server`, the `SEED_SERVER` variable, `server` in `~/.seed/config.json`, then `https://hyper.media`. One exception: an `https://` URL given as an id talks to that URL's own origin, whatever the server setting.

Output conventions: stdout carries only data, so piping is safe; status lines go to stderr as `✓`, `✗`, `ℹ` and `⚠`. `document get`, `draft get` and `document create --dry-run` print markdown by default; everything else prints JSON. Exit codes are `0` and `1` only; validation and verification failures also exit `1`.

Config lives in `~/.seed/config.json` (`server`, `defaultAccount`, `vaultPath`), written with `seed-cli config --server <url>`, `--vault-path <path>`, `--show`, and `seed-cli key default <name>`.

| Variable | Effect |
| --- | --- |
| `SEED_SERVER` | default server, below `--server` |
| `SEED_CLI_KEYFILE` | the contents of an unencrypted `.hmkey.json`; becomes the signing key for every write |
| `SEED_CLI_MNEMONIC` | a BIP-39 phrase used the same way; setting both is an error |
| `SEED_VAULT_PATH` | an explicit `vault.json`; vault errors become fatal |
| `SEED_VAULT_KEK` | the base64 32-byte vault unlock secret, for machines without a keychain |
| `SEED_CLI_DRAFTS_DIR` | where drafts are written |

# Keys and signing

The CLI signs locally and never asks a daemon or a vault service to sign. Keys come from three places, in this order of precedence: the environment (`SEED_CLI_KEYFILE` or `SEED_CLI_MNEMONIC`), the encrypted vault of a desktop app or daemon on the same machine (read-only), then the OS keyring, where `key generate` and `key import` write. `-k, --key <name>` picks a key by name or account id; without it the default key is the configured `defaultAccount`, else a key named `main`, else the first vault account. A key's name and its account id are different things: look up by either. [Keys](./keys.md) covers all of this in depth.

Writing into a space you do not own takes a capability: `-a, --account <uid>` on `document create` and `account profile set` looks up a WRITER or AGENT capability the space published for your key and puts its CID on the blob. See [Permissions](../protocol/permissions.md).

# Ids

Any command that takes an id accepts `hm://<uid>/<path>`, a bare `<uid>`, or an `https://` page URL, which is resolved through the site's `OPTIONS` headers. A path ending in `:directory` lists children. Comment ids are `<author>/<tsid>`; web URLs with a comments panel are recognised as comment ids. See [URLs](../protocol/urls.md).

# document

| Command | What it does |
| --- | --- |
| `document get <id>` | prints a document or comment as markdown with YAML frontmatter and `<!-- id:… -->` block comments; `-m` metadata only, `-r` resolves embeds, mentions and queries, `-o <file>` writes to a file. Follows redirects and republishes and says so. |
| `document create` | creates a document from `-f <file>` (`.md`, `.json` blocks, or `.pdf`) or stdin. `-p, --path` (default: a slug of the name; `/` is the home document), `--name`, `--summary`, `--display-author`, `--display-publish-time`, `--icon`, `--cover`, `--site-url`, `--layout`, `--show-outline` / `--no-show-outline`, `--show-activity` / `--no-show-activity`, `--content-width S|M|L`, `--children-type`, `--seed-experimental-logo`, `--seed-experimental-home-order`, `--import-categories`, `--import-tags`, `--metadata <json>` (any keys, merged last), `--attributes-schema <ref>`, `--child-attributes-schema <ref>`, `--schema-definition <file>`, `--grobid-url`, `--dry-run`, `--force` (overwrite an occupied path with a new lineage), `-k`, `-a`. |
| `document update <id>` | diffs `-f <file>` against the current content by block id and publishes only changed blocks; the metadata flags above, `--delete-blocks <ids>`, `-k`. Takes over the address of a redirect or republish. `--parent` is accepted but has no effect. |
| `document delete <id>` | publishes a tombstone Ref |
| `document fork <source> <destination>` | a new path on the source's history |
| `document move <source> <destination>` | a version Ref at the destination and a redirect at the source |
| `document redirect <id> --to <target> [--republish]` | a redirect Ref; with `--republish` the target's content shows at this path |
| `document changes <id>` | the change history (`ListChanges`) |
| `document stats <id>` | interaction counts |
| `document validate <id> [--content]` | checks the document against its effective attributes schema; exit 1 on violations |
| `document cid <cid>` | fetches a raw block |

Metadata precedence on create is defaults, then frontmatter or PDF, then flags, then `--metadata`. `file://` links in image blocks and in icon, cover and logo metadata are uploaded as IPFS files and rewritten to `ipfs://`. After creating a child, the CLI links it from the parent document. The genesis rule that makes a new document distinct from the home document is applied by the SDK; see [SDK](./sdk.md).

# comment

| Command | What it does |
| --- | --- |
| `comment get <id>` | one comment |
| `comment list <targetId>` | comments on a document |
| `comment create <targetId> --body <text> \| --file <path> [--reply <commentId>]` | a comment; the body is markdown. A `#blockId` fragment on the target makes a block comment. |
| `comment edit <commentId> --body \| --file` | replaces the comment, keeping its thread position |
| `comment delete <commentId>` | a tombstone |
| `comment discussions <targetId> [-c <id>]` | threaded discussions |

# capability, contact, account

| Command | What it does |
| --- | --- |
| `capability create --delegate <uid> --role WRITER\|AGENT [--path <p>] [--label <text>]` | signs and publishes a capability from your key to another account, optionally scoped to a path |
| `contact create --subject <uid> --name <name>` | a named reference to another account |
| `contact delete <recordId\|cid>` | a tombstone |
| `contact list [uid] [--account] [--subject]` | contacts by or about an account |
| `account get <uid>`, `account list`, `account contacts <uid>` | account lookups |
| `account profile set --name <n> [--icon ipfs://…] [--description <d>] [-a <uid>]` | publishes a profile blob; with `-a` another account's profile from a delegated key |
| `account capabilities <id>` | who may write to a space or path |

# key

| Command | What it does |
| --- | --- |
| `key generate [-n main] [-w 12\|24] [--passphrase] [--show-mnemonic]` | a new key in the OS keyring |
| `key import <mnemonic> [-n imported]` | a key from a BIP-39 phrase |
| `key list` | every key in the vault and the keyring, with its source |
| `key show [nameOrId]`, `key default [nameOrId]`, `key rename <old> <new>`, `key remove <nameOrId> [-f]` | keyring keys only for rename and remove; the CLI never modifies a vault |
| `key derive <mnemonic>` | prints the account id without storing anything |
| `key export [nameOrId] [-o <path>] [--password] [-f]` | writes a `.hmkey.json` (mode 0600) that the app, the vault and `SEED_CLI_KEYFILE` accept |

# draft

Drafts are local files the desktop app also sees: `draft create -f <file>` parses and validates input and saves it under the app's drafts directory (`SEED_CLI_DRAFTS_DIR` overrides) with an entry in the app's draft index; `--edit <hm-url>` marks it as an edit of an existing document, `--location <hm-url>` as a new child, `--visibility PUBLIC|PRIVATE`. `draft get <slug>`, `draft list` and `draft rm [<slug>] [--all] [--force]` complete the set. An agent that writes drafts instead of publishing lets a person review in the app; see [Using Seed from your own agent](./agents.md).

# space

| Command | What it does |
| --- | --- |
| `space export <space\|self> -d <dir>` | writes every document of a space as lossless markdown, home document as `index.md`, `/a/b` as `a/b.md`, a defined schema as `a/b.schema.json` |
| `space import <space\|self> -d <dir> [--dry-run] [--check]` | publishes the directory, diffing existing documents by block id and detecting moves; `--check` validates every file against its schema first and publishes nothing on a violation. The signing key must own the space. |
| `space dev -d <dir> [--api http://localhost:58004] [--daemon http://localhost:58001] [--interval 2000] [--no-push] [--no-watch] [--keep-stale]` | edits the directory in the desktop dev app under a throwaway key |

[Publish a folder](./publish-a-folder.md) explains the dialect and the loop.

# blob and schema

| Command | What it does |
| --- | --- |
| `blob get <cid>` | prints a blob as dag-json |
| `blob validate -f <file> [-s <ref>]` | checks a dag-json value against a schema (a file, `ipfs://<cid>`, a library name, or a type document's `hm://` URL) |
| `blob create -f <file> [-s <ref>] [--no-link] [--force] [--dry-run]` | publishes a value as a DAG-CBOR blob, validated and linked to its schema |
| `blob sign -f <file> [-s <ref>] [-t <type>] [--ts <ms>] [-k] [--force] [--dry-run]` | adds the signed envelope (`signer`, `ts`, `sig`) and publishes |
| `blob verify <cid> [-s <ref>]` | checks the signature and the schema |
| `schema get <ref> [--resolve]` | a schema with its CID; `--resolve` follows references and merges extensions |
| `schema validate <ref>` | is this a valid Hypermedia schema |

Publishing a schema of your own is `document create --schema-definition <file>`. [Hypermedia Schemas](../schema.md) and [the one-page reference](../schema/quick-reference.md) show the whole workflow.

# search, query, attributes, citations, activity

| Command | What it does |
| --- | --- |
| `search <query> [-a <uid>] [-t keyword\|semantic\|hybrid] [-c <n>] [-l <n>] [--titles-only]` | full-text search; `-q` prints `id`, block, type and title per line |
| `query <space\|*> [-p <path>] [-m Children\|AllDescendants] [-l <n>] [--sort <term>] [--reverse]` | a directory listing |
| `query <space\|*> -w '<explore query>' [--filter <json>] [--sort-by <key>] [--page-token <t>]` | documents by attribute, anywhere with `*`; see [Query grammar](./query-grammar.md) |
| `children <space> [-p <path>]` | shorthand for a `Children` query |
| `attributes [space] [--parent <path>] [--recursive] [--values <key>] [--kind string\|int\|bool] [--prefix <text>]` | which attribute keys documents use and the values a key takes |
| `citations <id>` | documents that link here |
| `activity [-l <n>] [-t <token>] [--authors <uids>] [--resource <id>]` | the event feed |

# Publishing this folder <!-- id:S9sJBMK0 -->

The documentation you are reading is a folder of markdown in the Seed repository, published with the `space` commands wrapped by a small script that knows the folder's layout (`<x>.md` publishes at `/<x>`, `README.md` stays on GitHub) and verifies every schema against its lockfile first.

- `./dev hm-sync` runs the editing loop for `hypermedia/` (`./dev hm-sync <dir>` for any other folder); `./dev up` runs it as the `hm-sync` pane. <!-- id:fdA1E3H4 -->
- `pnpm hypermedia:push` publishes `hypermedia/` to the Hypermedia site on hyper.media with the `main` key (`--dry-run` to preview). <!-- id:SU-YBU1V -->
- `pnpm hypermedia:pull` writes the published site back into `hypermedia/`. <!-- id:AFS_mXqg -->
- A commit to `main` that touches `hypermedia/` publishes it from CI. <!-- id:QkZSrmRL -->

[Publish a folder](./publish-a-folder.md) is the full guide.

# Working with it

## In the Seed app

Drafts the CLI writes appear in the app's draft list; keys the app holds in its vault are readable by the CLI on the same machine.

## SDK

Each command is a short composition of [SDK](./sdk.md) calls plus one `PublishBlobs` request; the CLI source is the best set of worked examples.

## Web API

The CLI is a client of the [Seed API](./web-api.md) and nothing else, except `space dev`, which registers its throwaway key in the dev daemon over gRPC-web.

## Agents

The CLI is the recommended way for an external agent to touch Seed. Run it as `npx -y @seed-hypermedia/cli@latest …`, keep a bot key with a delegated capability, and prefer `draft create` when a person should review before anything is published. [Using Seed from your own agent](./agents.md) has the workflow; Seed Agents expose the same operations through their `read` and `write` verbs instead.

# See also

- [Keys](./keys.md), [Publish a folder](./publish-a-folder.md), [Query grammar](./query-grammar.md)
- [The Seed CLI app page](../apps/cli.md) for where the code lives and how it is tested
