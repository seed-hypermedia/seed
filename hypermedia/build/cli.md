---
name: Seed CLI
summary: The seed-cli reference, from install and signing keys through every command group and flag, with the commands this documentation folder is published with.
---
The Seed CLI (`seed-cli`) reads and writes the Hypermedia network from a terminal. It signs everything locally with an Ed25519 [key](./keys.md) you hold. It talks to any Seed [site](../protocol/sites.md) over the [Seed API](./web-api.md), and prints [documents](../protocol/documents.md) as markdown you can edit and send back. Agents script Seed with it too: a Claude Code session with the [seed-cli skill](./agents.md) runs these same commands. <!-- id:BvAYnvta -->

# Install <!-- id:XCJLULjs -->

```sh <!-- id:-O0KfGcc -->
npx -y @seed-hypermedia/cli --help        # run without installing
npm install -g @seed-hypermedia/cli       # or install; provides `seed-cli` and `seed-hypermedia`
```

It needs Node 18 or newer. The package is a single bundle with the [SDK](./sdk.md) inside. CI publishes a new patch version on every push to `main` that touches it, so `npx …@latest` follows `main`. As of mid-September 2026 the npm release (0.2.9) predates the [Hypermedia Schemas](../schema.md) work. These need a build from source until the next release: the `blob`, `schema` and `attributes` commands, `query --where` and `--filter`, `document validate`, the `--metadata` and schema flags on `document create` and `update`, `space import --check`, and `space dev --no-watch` and `--keep-stale`. From a checkout, `bun run src/index.ts …` in `frontend/apps/cli` runs it from source, and `./dev install-cli` links it. <!-- id:wz0RTKXt -->

# Global options <!-- id:I7ujuhgH -->

<!-- id:79TTD_ll -->
| Option <!-- col:GtyhpCfl --> | Meaning <!-- col:7unoBNLR --> <!-- id:57iFwwAJ --> |
| --- | --- |
| `-s, --server <url>` | the Seed web server to talk to (default `https://hyper.media`) <!-- id:s-V-QQ9c --> |
| `--dev` | development environment: `https://dev.hyper.media` plus the dev keyring and vault; cannot be combined with `--server` <!-- id:YNAbsqX5 --> |
| `--json`, `--yaml` | structured output (`--md`, the markdown default, is accepted but changes nothing) <!-- id:xjlu3aC5 --> |
| `--pretty` | colourised JSON or YAML, or markdown rendered for the terminal <!-- id:pU3ldSBJ --> |
| `-q, --quiet` | one tab-separated line per item, no status messages <!-- id:AqHE70t9 --> |
| `--vault <path>` | a desktop or daemon `vault.json` to read identities from (default: auto-detect) <!-- id:HYR-GLl8 --> |
| `-V, --version`, `-h, --help` | <!-- id:6dKIysTS --> |

The server is resolved in this order: `--dev`, `--server`, the `SEED_SERVER` variable, `server` in `~/.seed/config.json`, then `https://hyper.media`. One exception: an `https://` URL given as an id talks to that URL's own origin, whatever the server setting. <!-- id:XV06Gebc -->

Output conventions: stdout carries only data, so piping is safe. Status lines go to stderr as `✓`, `✗`, `ℹ` and `⚠`. `document get` (JSON with `-m`), `draft get` and `document create --dry-run` print markdown by default. Everything else prints JSON. Exit codes are `0` and `1` only. Validation and verification failures also exit `1`. <!-- id:ux90dCEZ -->

Config lives in `~/.seed/config.json` (`server`, `defaultAccount`, `vaultPath`), written with `seed-cli config --server <url>`, `--vault-path <path>`, `--show`, and `seed-cli key default <name>`. <!-- id:hoqqIrOF -->

<!-- id:vbR2OTmt -->
| Variable <!-- col:jP7FMWT2 --> | Effect <!-- col:F4bDX3NL --> <!-- id:thTyldDd --> |
| --- | --- |
| `SEED_SERVER` | default server, below `--server` <!-- id:dGcj7N1h --> |
| `SEED_CLI_KEYFILE` | the contents of an unencrypted `.hmkey.json`; becomes the signing key for every write <!-- id:otB3tiTQ --> |
| `SEED_CLI_MNEMONIC` | a BIP-39 phrase used the same way; setting both is an error <!-- id:OWlx7P7f --> |
| `SEED_VAULT_PATH` | an explicit `vault.json`; vault errors become fatal <!-- id:bWEn91kN --> |
| `SEED_VAULT_KEK` | the base64 32-byte key-encryption key that unwraps the vault's data key, for machines without a keychain <!-- id:36-JJKGp --> |
| `SEED_CLI_DRAFTS_DIR` | where drafts are written <!-- id:UMnYFE0U --> |

# Keys and signing <!-- id:aswGrLxU -->

The CLI signs locally and never asks a [daemon](../apps/daemon.md) or a [vault](../apps/vault.md) service to sign. Keys come from three places, in this order of precedence: the environment (`SEED_CLI_KEYFILE` or `SEED_CLI_MNEMONIC`), the encrypted vault of a desktop app or daemon on the same machine (read-only), then the OS keyring, where `key generate` and `key import` write. `-k, --key <name>` picks a key by name or [account](../protocol/identity.md) id. Without it the default key is the configured `defaultAccount`, else a key named `main`, else the first vault account. A key's name and its account id are different things. You can look up by either. [Keys](./keys.md) covers all of this in depth. <!-- id:qfwJg4ST -->

Writing into a [space](../protocol/identity.md) you do not own takes a [capability](../protocol/permissions.md). `-a, --account <uid>` on `document create` and `account profile set` looks up a WRITER or AGENT capability the space published for your key and puts its [CID](../protocol/blobs.md) on the [blob](../protocol/blobs.md). `document update` and `document delete` do the same lookup for the document's own space without a flag. See [Permissions](../protocol/permissions.md). <!-- id:2HxII8x6 -->

# Ids <!-- id:o86uuWD- -->

Any command that takes an id accepts `hm://<uid>/<path>`, a bare `<uid>`, or an `https://` page URL, which is resolved through the site's `OPTIONS` headers. Given to `document get`, a path ending in `:directory` lists the children. [Comment](../protocol/comments.md) ids are `<author>/<tsid>`. Web URLs with a comments panel are recognised as comment ids. See [URLs](../protocol/urls.md). <!-- id:oxYTd235 -->

# document <!-- id:i0pxk9fs -->

<!-- id:qijTrXEQ -->
| Command <!-- col:JPX23dD8 --> | What it does <!-- col:TWw0cJY2 --> <!-- id:r2M5zqO6 --> |
| --- | --- |
| `document get <id>` | prints a document or comment as markdown with YAML frontmatter and `<!-- id:… -->` block comments; `-m` metadata only, `-r` resolves embeds, mentions and queries, `-o <file>` writes to a file. Follows redirects and republishes and says so. <!-- id:k7DwdrM6 --> |
| `document create` | creates a document from `-f <file>` (`.md`, `.json` blocks, or `.pdf`) or stdin. `-p, --path` (default: a slug of the name; `/` is the home document), `--name`, `--summary`, `--display-author`, `--display-publish-time`, `--icon`, `--cover`, `--site-url`, `--layout`, `--show-outline` / `--no-show-outline`, `--show-activity` / `--no-show-activity`, `--content-width` (`S`, `M` or `L`), `--children-type`, `--seed-experimental-logo`, `--seed-experimental-home-order`, `--import-categories`, `--import-tags`, `--metadata <json>` (any keys, merged last), `--attributes-schema <ref>`, `--child-attributes-schema <ref>`, `--schema-definition <file>`, `--grobid-url`, `--dry-run`, `--force` (overwrite an occupied path with a new lineage), `-k`, `-a`. <!-- id:OIS2RpKN --> |
| `document update <id>` | diffs `-f <file>` against the current content by block id and publishes only changed blocks; the metadata flags above, `--delete-blocks <ids>`, `-k`. Takes over the address of a redirect or republish. `--parent` is accepted but has no effect. <!-- id:tnRmEpG5 --> |
| `document delete <id>` | publishes a tombstone Ref <!-- id:-VbBSHZ_ --> |
| `document fork <source> <destination>` | a new path on the source's history <!-- id:eyvdqDUC --> |
| `document move <source> <destination>` | a version Ref at the destination and a redirect at the source <!-- id:B5EPykr7 --> |
| `document redirect <id> --to <target> [--republish]` | a redirect Ref; with `--republish` the target's content shows at this path <!-- id:JRNLjoGN --> |
| `document changes <id>` | the change history (`ListChanges`) <!-- id:NrxnVjXX --> |
| `document stats <id>` | interaction counts <!-- id:RbkZ0A9H --> |
| `document validate <id> [--content]` | checks the document against its effective attributes schema; exit 1 on violations <!-- id:2PWOgnvd --> |
| `document cid <cid>` | fetches a raw block <!-- id:TTzBDoke --> |

[Metadata](../metadata.md) precedence on create is defaults, then frontmatter or PDF, then flags, then `--metadata`. `file://` links in image [blocks](../protocol/blocks.md) and in icon, cover and logo metadata are uploaded as [IPFS files](../protocol/files.md) and rewritten to `ipfs://`. After creating a child, the CLI links it from the parent document. The SDK applies the [genesis](../protocol/documents.md) rule that makes a new document distinct from the home document. See [SDK](./sdk.md). <!-- id:byfHfFJe -->

# comment <!-- id:RYYLyDKM -->

<!-- id:Nfp1AYor -->
| Command <!-- col:mFjvv1iP --> | What it does <!-- col:DXAErmnk --> <!-- id:a9uKU434 --> |
| --- | --- |
| `comment get <id>` | one comment <!-- id:u5Q7k2Lb --> |
| `comment list <targetId>` | comments on a document <!-- id:PgseIIZu --> |
| `comment create <targetId> --body <text> \| --file <path> [--reply <commentId>]` | a comment; the body is markdown. A `#blockId` fragment on the target makes a block comment. <!-- id:Sm2JQV1g --> |
| `comment edit <commentId> --body \| --file` | replaces the comment, keeping its thread position <!-- id:gvxftUAX --> |
| `comment delete <commentId>` | a tombstone <!-- id:zxRgmYi7 --> |
| `comment discussions <targetId> [-c <id>]` | threaded discussions <!-- id:4EXxvGHc --> |

# capability, contact, account <!-- id:u-P9G1ps -->

<!-- id:ImsO5cZd -->
| Command <!-- col:yvZUqXnN --> | What it does <!-- col:9ooDPbDC --> <!-- id:a5dcw4lR --> |
| --- | --- |
| `capability create --delegate <uid> --role WRITER\|AGENT [--path <p>] [--label <text>]` | signs and publishes a capability from your key to another account, optionally scoped to a path <!-- id:F6Kt_lxg --> |
| `contact create --subject <uid> --name <name>` | a named reference to another account <!-- id:bXrh0yqo --> |
| `contact delete <recordId\|cid>` | a tombstone <!-- id:1hHcJgUQ --> |
| `contact list [uid] [--account] [--subject]` | contacts by or about an account <!-- id:VE6uvTkk --> |
| `account get <uid>`, `account list`, `account contacts <uid>` | account lookups <!-- id:38Ki-SVd --> |
| `account profile set --name <n> [--icon ipfs://…] [--description <d>] [-a <uid>]` | publishes a profile blob; with `-a` another account's profile from a delegated key <!-- id:Kq_fbrrn --> |
| `account capabilities <id>` | who may write to a space or path <!-- id:3r9D7IXb --> |

# key <!-- id:wYV1u256 -->

<!-- id:W7tZJSXJ -->
| Command <!-- col:pMDjmRn_ --> | What it does <!-- col:FXido-VO --> <!-- id:M4znTrdE --> |
| --- | --- |
| `key generate [-n main] [-w 12\|24] [--passphrase] [--show-mnemonic]` | a new key in the OS keyring <!-- id:bYAhe-_6 --> |
| `key import <mnemonic> [-n imported]` | a key from a BIP-39 phrase <!-- id:XB8D-uWf --> |
| `key list` | every key in the vault and the keyring, with its source <!-- id:RUNgqs1Z --> |
| `key show [nameOrId]`, `key default [nameOrId]`, `key rename <old> <new>`, `key remove <nameOrId> [-f]` | keyring keys only for rename and remove; the CLI never modifies a vault <!-- id:zczDJnZ8 --> |
| `key derive <mnemonic>` | prints the account id without storing anything <!-- id:2z7oaVa8 --> |
| `key export [nameOrId] [-o <path>] [--password] [-f]` | writes a `.hmkey.json` (mode 0600) that the app, the vault and `SEED_CLI_KEYFILE` accept <!-- id:jYxmDiSq --> |

# draft <!-- id:s6g4Q_0z -->

[Drafts](../protocol/documents.md) are local files the [desktop app](../apps/desktop.md) also sees. `draft create -f <file>` parses and validates input and saves it under the app's drafts directory (`SEED_CLI_DRAFTS_DIR` overrides), with an entry in the app's draft index. `--edit <hm-url>` marks it as an edit of an existing document, `--location <hm-url>` as a new child, and `--visibility PUBLIC|PRIVATE` sets its [visibility](../protocol/privacy.md). `draft get <slug>`, `draft list` and `draft rm [<slug>] [--all] [--force]` complete the set. An agent that writes drafts instead of publishing lets a person review in the app. See [Using Seed from your own agent](./agents.md). <!-- id:1AfMtS9j -->

# space <!-- id:VYbYjx_0 -->

<!-- id:2U85U0hx -->
| Command <!-- col:kdniFv11 --> | What it does <!-- col:IiIZbRfZ --> <!-- id:3r8LBHi0 --> |
| --- | --- |
| `space export <space\|self> -d <dir>` | writes every document of a space as lossless markdown, home document as `index.md`, `/a/b` as `a/b.md`, a defined schema as `a/b.schema.json` <!-- id:8xVuFg6X --> |
| `space import <space\|self> -d <dir> [--dry-run] [--check]` | publishes the directory, diffing existing documents by block id and detecting moves; `--check` validates every file against its schema first and publishes nothing on a violation. The signing key must own the space. <!-- id:ZupCY3QW --> |
| `space export <space\|self> -d <dir> --assets` | also downloads every file the documents link into `<dir>/assets/` and links it relatively |
| `space archive <space\|self> -o <file.zip> [--format markdown\|blobs] [--no-comments]` | saves the whole space in one zip. `markdown` (the default) is the `space export` folder with its assets, readable anywhere. `blobs` is every signed blob of the space (Refs, changes, capabilities, comments, file blocks), byte for byte, each checked against its CID |
| `space restore <file.zip> [--into <space\|self>] [-d <dir>] [--dry-run]` | a blob archive is published as is to `--server`, with its signatures and history intact. A markdown archive is imported into `--into` (default `self`) like `space import`, as new changes signed by your key |
| `space dev -d <dir> [--api http://localhost:58004] [--daemon http://localhost:58001] [--interval 2000] [--no-push] [--no-watch] [--keep-stale]` | edits the directory in the desktop dev app under a throwaway key <!-- id:gwBM5yqo --> |

[Publish a folder](./publish-a-folder.md) explains the dialect and the loop. <!-- id:ZalQUTp2 -->

# blob and schema <!-- id:EWm_MlD9 -->

<!-- id:Twaa3_pb -->
| Command <!-- col:YTxU9OxB --> | What it does <!-- col:NpgF4otZ --> <!-- id:UMdG0Pru --> |
| --- | --- |
| `blob get <cid>` | prints a blob as dag-json <!-- id:AO87m6qR --> |
| `blob validate -f <file> [-s <ref>]` | checks a dag-json value against a schema (a file, `ipfs://<cid>`, a library name, or a type document's `hm://` URL) <!-- id:xnHBjwfY --> |
| `blob create -f <file> [-s <ref>] [--no-link] [--force] [--dry-run]` | publishes a value as a DAG-CBOR blob, validated and linked to its schema <!-- id:FL7NfiCU --> |
| `blob sign -f <file> [-s <ref>] [-t <type>] [--ts <ms>] [-k] [--force] [--dry-run]` | adds the signed envelope (`signer`, `ts`, `sig`) and publishes <!-- id:mt3aTOW- --> |
| `blob verify <cid> [-s <ref>]` | checks the signature and the schema <!-- id:TQZAGmBj --> |
| `schema get <ref> [--resolve]` | a schema with its CID; `--resolve` follows references and merges extensions <!-- id:zSrsps2J --> |
| `schema validate <ref>` | is this a valid Hypermedia schema <!-- id:rmUqkhgh --> |

To publish a schema of your own, use `document create --schema-definition <file>`. [Hypermedia Schemas](../schema.md) and [the one-page reference](../schema/quick-reference.md) show the whole workflow. <!-- id:uMkNH8QA -->

# search, query, attributes, citations, activity <!-- id:tPQuaVdB -->

<!-- id:w1r5uG3b -->
| Command <!-- col:cr6NCsK1 --> | What it does <!-- col:UZ_J42lQ --> <!-- id:-oqA7zTL --> |
| --- | --- |
| `search <query> [-a <uid>] [-t keyword\|semantic\|hybrid] [-c <n>] [-l <n>] [--titles-only]` | full-text search; `-q` prints `id`, block, type and title per line <!-- id:hTGBOwkH --> |
| `query <space\|*> [-p <path>] [-m Children\|AllDescendants] [-l <n>] [--sort <term>] [--reverse]` | a directory listing <!-- id:h7lhzHdo --> |
| `query <space\|*> -w '<explore query>' [--filter <json>] [--sort-by <key>] [--page-token <t>]` | documents by attribute, anywhere with `*`; see [Query grammar](./query-grammar.md) <!-- id:XlTeTLKd --> |
| `children <space> [-p <path>]` | shorthand for a `Children` query <!-- id:0GGdbwBx --> |
| `attributes [space] [--parent <path>] [--recursive] [--values <key>] [--kind string\|int\|bool] [--prefix <text>]` | which attribute keys documents use and the values a key takes <!-- id:Dldvm9Oz --> |
| `citations <id>` | documents that link here <!-- id:iZoE-r1W --> |
| `activity [-l <n>] [-t <token>] [--authors <uids>] [--resource <id>]` | the event feed <!-- id:2fAhaJLE --> |

# Publishing this folder <!-- id:S9sJBMK0 -->

The documentation you are reading is a folder of markdown in the Seed repository. A small script wraps the `space` commands to publish it. The script knows the folder's layout (`<x>.md` publishes at `/<x>`, `README.md` stays on GitHub) and first verifies every schema against its lockfile. <!-- id:DMpmJCIF -->
  - `./dev hm-sync` runs the editing loop for `hypermedia/` (`./dev hm-sync <dir>` for any other folder). `./dev up` runs it as the `hm-sync` pane. <!-- id:fdA1E3H4 -->
  - `pnpm hypermedia:push` publishes `hypermedia/` to the Hypermedia site on hyper.media with the `main` key (`--dry-run` to preview). <!-- id:SU-YBU1V -->
  - `pnpm hypermedia:pull` writes the published site back into `hypermedia/`. <!-- id:AFS_mXqg -->
  - A commit to `main` that touches `hypermedia/` publishes it from CI. <!-- id:QkZSrmRL -->

[Publish a folder](./publish-a-folder.md) is the full guide. <!-- id:MAkKIC_c -->

# Working with it <!-- id:n40J-d0M -->

## In the Seed app <!-- id:ljnmGTI4 -->

Drafts the CLI writes appear in the app's draft list. The CLI can read keys the app holds in its vault on the same machine. <!-- id:bATSGQNf -->

## SDK <!-- id:kY71qpic -->

Each command is a few [SDK](./sdk.md) calls plus one `PublishBlobs` request. The CLI source is the best set of worked examples. <!-- id:Eg9Qe8bn -->

## Web API <!-- id:jEgpIy-H -->

The CLI is a client of the [Seed API](./web-api.md) and nothing else, except `space dev`, which registers its throwaway key in the dev daemon over gRPC-web. <!-- id:mNNH0YPn -->

## Agents <!-- id:4PWuqJLM -->

The CLI is the recommended way for an external agent to touch Seed. Run it as `npx -y @seed-hypermedia/cli@latest …`, keep a bot key with a delegated capability, and prefer `draft create` when a person should review before anything is published. [Using Seed from your own agent](./agents.md) has the workflow. [Seed Agents](../agent.md) expose the same operations through their [`read`](../agent/read.md) and [`write`](../agent/write.md) verbs. <!-- id:bSJNd5GE -->

# See also <!-- id:lZnXkUAB -->

- [Keys](./keys.md) <!-- id:sjB5BRW_ -->
- [The Seed CLI app page](../apps/cli.md), for where the code lives and how it is tested <!-- id:PEaV_SgZ -->
- [Publish a folder](./publish-a-folder.md) <!-- id:DQ2RF-Di -->
- [Query grammar](./query-grammar.md) <!-- id:hogVlMfc -->
- [Using Seed from your own agent](./agents.md) <!-- id:tGU9ay8W -->
- [SDK](./sdk.md) <!-- id:Txl_sF-C -->
- [Seed API](./web-api.md) <!-- id:9goznpU9 -->
