# Seed Hypermedia CLI

A command-line interface for interacting with the Seed Hypermedia network. Create, read, update, and delete documents;
manage accounts, comments, contacts, and capabilities; sign content with Ed25519 keys — all from your terminal.

**Package:** `@seed-hypermedia/cli` **Version:** 0.1.1 **License:** MIT **Requires:** Node.js >= 18.0.0

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Global Options](#global-options)
- [Configuration](#configuration)
- [Document Commands](#document-commands)
  - [document get](#document-get)
  - [document create](#document-create)
  - [document update](#document-update)
  - [document delete](#document-delete)
  - [document fork](#document-fork)
  - [document move](#document-move)
  - [document redirect](#document-redirect)
  - [document changes](#document-changes)
  - [document stats](#document-stats)
  - [document cid](#document-cid)
- [Account Commands](#account-commands)
  - [account get](#account-get)
  - [account list](#account-list)
  - [account contacts](#account-contacts)
  - [account capabilities](#account-capabilities)
- [Comment Commands](#comment-commands)
  - [comment get](#comment-get)
  - [comment list](#comment-list)
  - [comment create](#comment-create)
  - [comment delete](#comment-delete)
  - [comment discussions](#comment-discussions)
- [Contact Commands](#contact-commands)
  - [contact create](#contact-create)
  - [contact delete](#contact-delete)
  - [contact list](#contact-list)
- [Capability Commands](#capability-commands)
  - [capability create](#capability-create)
- [Key Management Commands](#key-management-commands)
  - [key generate](#key-generate)
  - [key import](#key-import)
  - [key list](#key-list)
  - [key show](#key-show)
  - [key default](#key-default)
  - [key remove](#key-remove)
  - [key rename](#key-rename)
  - [key derive](#key-derive)
- [Search & Discovery Commands](#search--discovery-commands)
  - [search](#search)
  - [query](#query)
  - [children](#children)
  - [citations](#citations)
  - [activity](#activity)
- [Hypermedia ID Format](#hypermedia-id-format)
- [Output Formats](#output-formats)
- [Markdown Conversion](#markdown-conversion)
- [Key Storage & Cryptography](#key-storage--cryptography)
- [Signing & Blob Architecture](#signing--blob-architecture)
- [Environment Variables](#environment-variables)
- [Error Handling](#error-handling)
- [Scripting Examples](#scripting-examples)
- [Development](#development)

---

## Installation

```bash
# Install globally via npm
npm install -g @seed-hypermedia/cli

# Or run directly with npx (no install needed)
npx -y @seed-hypermedia/cli --help
```

After installation, the CLI is available as both `seed-cli` and `seed-hypermedia`.

### Development Mode

```bash
cd frontend/apps/cli

# Run directly with bun
bun run src/index.ts [command]

# Or use the dev script
bun run dev [command]
```

---

## Quick Start

```bash
# 1. Generate a signing key
seed-cli key generate -n mykey --show-mnemonic

# 2. Create a document
seed-cli document create z6MkrbYs... --title "My First Document" --body "Hello, world!"

# 3. Read it back
seed-cli document get hm://z6MkrbYs.../my-first-document --md

# 4. Search for content
seed-cli search "hello world"

# 5. List all accounts
seed-cli account list
```

---

## Global Options

These options apply to every command and must appear before the subcommand:

| Option               | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `-s, --server <url>` | Server URL (default: `https://hyper.media` or `$SEED_SERVER`) |
| `--json`             | JSON output (default)                                         |
| `--yaml`             | YAML output                                                   |
| `--pretty`           | Pretty-formatted colorized output                             |
| `-q, --quiet`        | Minimal output (tab-separated values for scripting)           |
| `--dev`              | Use development keyring (`seed-daemon-dev`)                   |
| `-V, --version`      | Display version number                                        |
| `-h, --help`         | Display help                                                  |

**Examples:**

```bash
# Use a different server
seed-cli --server http://localhost:4000 account list

# Get YAML output
seed-cli account list --yaml

# Pretty-printed colorized JSON
seed-cli account get z6Mk... --pretty

# Quiet mode for piping
seed-cli account list -q | head -5

# Use development keyring
seed-cli --dev key list
```

---

## Configuration

The CLI stores configuration in `~/.seed/config.json` (mode `0600`).

### `config`

Manage CLI configuration.

| Option           | Description                |
| ---------------- | -------------------------- |
| `--server <url>` | Set default server URL     |
| `--show`         | Show current configuration |

```bash
# Show current config
seed-cli config --show

# Set default server
seed-cli config --server https://my-server.example.com
```

**Config fields:**

| Field            | Description                           |
| ---------------- | ------------------------------------- |
| `server`         | Default server URL                    |
| `defaultAccount` | Account ID of the default signing key |

---

## Document Commands

All document commands live under `seed-cli document <subcommand>`.

### document get

Fetch a document, comment, or entity by Hypermedia ID.

```
seed-cli document get <id> [options]
```

| Option           | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `-m, --metadata` | Fetch metadata only (faster, skips content)             |
| `--md`           | Output as Markdown                                      |
| `--frontmatter`  | Include YAML frontmatter (requires `--md`)              |
| `-r, --resolve`  | Resolve embeds, mentions, and queries (requires `--md`) |
| `-q, --quiet`    | Print document title only (or ID if untitled)           |

**Examples:**

```bash
# Get full document as JSON
seed-cli document get hm://z6Mk.../my-doc

# Get as Markdown
seed-cli document get hm://z6Mk.../my-doc --md

# Get as Markdown with YAML frontmatter and resolved embeds
seed-cli document get hm://z6Mk.../my-doc --md --frontmatter --resolve

# Get metadata only (name, summary, etc.)
seed-cli document get hm://z6Mk.../my-doc -m

# Get a specific version
seed-cli document get "hm://z6Mk.../my-doc?v=bafy2bzace..."

# Get a nested child document
seed-cli document get hm://z6Mk.../projects/alpha

# Get just the title
seed-cli document get hm://z6Mk.../my-doc -q

# Also works for comments
seed-cli document get "hm://z6Mk...?c=bafy..."
```

**Behavior:**

- When the resource is a `document`, outputs document content.
- When the resource is a `comment`, outputs comment content.
- With `--md`, converts block content to GitHub-flavored Markdown.
- With `--md --resolve`, fetches embedded documents and query results, inlining their content.
- With `--metadata`, fetches only the lightweight metadata payload.

---

### document create

Create a new document from Markdown or HMBlockNodes JSON.

```
seed-cli document create <account> [options]
```

| Option                 | Description                              |
| ---------------------- | ---------------------------------------- |
| `--title <title>`      | **Required.** Document title             |
| `-p, --path <path>`    | Document path (default: slugified title) |
| `--body <text>`        | Markdown content (inline)                |
| `--body-file <file>`   | Read Markdown content from a file        |
| `--blocks <json>`      | HMBlockNodes JSON (inline)               |
| `--blocks-file <file>` | Read HMBlockNodes JSON from a file       |
| `-k, --key <name>`     | Signing key name or account ID           |

**Constraints:**

- Exactly one content source is required: `--body`, `--body-file`, `--blocks`, or `--blocks-file`.
- `--body`/`--body-file` and `--blocks`/`--blocks-file` are mutually exclusive.
- The `--title` option is required.

**Examples:**

```bash
# Create with inline Markdown
seed-cli document create z6Mk... --title "My Article" --body "# Introduction\n\nHello!"

# Create from a Markdown file
seed-cli document create z6Mk... --title "My Article" --body-file article.md

# Create from HMBlockNodes JSON
seed-cli document create z6Mk... --title "Structured Doc" --blocks-file blocks.json

# Create with custom path
seed-cli document create z6Mk... --title "My Article" --path "articles/2024/my-article" --body "content"

# Create with a specific signing key
seed-cli document create z6Mk... --title "My Article" --body "content" --key author
```

**Under the hood:**

1. Creates a genesis change blob (empty, signed).
2. Creates a document change blob containing the title and content operations.
3. Creates a version ref blob pointing to the change.
4. Publishes all three blobs to the server.

**Output:**

```
✓ Document created: hm://z6Mk.../my-article
ℹ Title: My Article
ℹ Path: /my-article
ℹ Genesis CID: bafy2bzace...
ℹ Change CID: bafy2bzace...
```

---

### document update

Update document metadata, append content, replace content, or delete blocks.

```
seed-cli document update <id> [options]
```

| Option                  | Description                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `-f, --file <path>`     | Input file (format detected by extension: .md, .json). Diffs against existing content. |
| `--title <title>`       | Set document title                                                                     |
| `--summary <summary>`   | Set document summary                                                                   |
| `--parent <blockId>`    | Parent block ID for new content (default: root)                                        |
| `--delete-blocks <ids>` | Comma-separated block IDs to delete                                                    |
| `-k, --key <name>`      | Signing key name or account ID                                                         |

**Constraints:**

- At least one update option must be specified.

**Examples:**

```bash
# Update the title
seed-cli document update hm://z6Mk.../my-doc --title "New Title"

# Update content from a Markdown file (smart diff — only changed blocks are submitted)
seed-cli document update hm://z6Mk.../my-doc -f updated.md

# Delete specific blocks
seed-cli document update hm://z6Mk.../my-doc --delete-blocks "blk-abc123,blk-def456"

# Combine metadata and content updates
seed-cli document update hm://z6Mk.../my-doc --title "Updated" --summary "A summary" -f content.md
```

**Smart diff (`-f`):**

When `-f` is used, the CLI performs a per-block diff against the existing document:

1. Each input block's ID is checked against the old document's block map.
2. If the ID exists: content is compared, and only changed blocks get a `ReplaceBlock` op.
3. If the ID doesn't exist: the block is treated as new (emits `ReplaceBlock`).
4. Old blocks whose IDs are absent from the input are deleted (`DeleteBlocks`).
5. Block ordering is updated via `MoveBlocks`.

This means editing a document exported with `document get` (which includes `<!-- id:... -->` comments in Markdown, or
block IDs in JSON) produces minimal updates. Plain Markdown without ID comments results in a full body replacement,
since none of the generated IDs will match the existing document.

---

### document delete

Delete a document by publishing a tombstone ref.

```
seed-cli document delete <id> [options]
```

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `-k, --key <name>` | Signing key name or account ID |

```bash
seed-cli document delete hm://z6Mk.../my-doc --key author
```

The document isn't physically removed — a tombstone ref is published, which tells clients the document has been
intentionally deleted.

---

### document fork

Fork a document to a new location (creates a copy).

```
seed-cli document fork <sourceId> <destinationId> [options]
```

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `-k, --key <name>` | Signing key name or account ID |

```bash
seed-cli document fork hm://z6Mk.../original hm://z6Mk.../copy --key author
```

**Behavior:**

- Creates a version ref at the destination pointing to the source's genesis and version.
- Does **not** create a redirect at the source (unlike `move`).
- The fork is an independent copy that shares the same genesis.

---

### document move

Move a document to a new location (fork + redirect at source).

```
seed-cli document move <sourceId> <destinationId> [options]
```

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `-k, --key <name>` | Signing key name or account ID |

```bash
seed-cli document move hm://z6Mk.../old-path hm://z6Mk.../new-path --key author
```

**Behavior:**

1. Creates a version ref at the destination (same as `fork`).
2. Creates a redirect ref at the source pointing to the destination.
3. Clients following the source URL will be transparently redirected.

---

### document redirect

Create a redirect from one document to another.

```
seed-cli document redirect <id> [options]
```

| Option             | Description                                       |
| ------------------ | ------------------------------------------------- |
| `--to <targetId>`  | **Required.** Target Hypermedia ID to redirect to |
| `--republish`      | Republish target content at this location         |
| `-k, --key <name>` | Signing key name or account ID                    |

```bash
# Simple redirect
seed-cli document redirect hm://z6Mk.../old-page --to hm://z6Mk.../new-page

# Redirect with content republishing
seed-cli document redirect hm://z6Mk.../mirror --to hm://z6Mk.../original --republish
```

---

### document changes

List document change history (version DAG).

```
seed-cli document changes <targetId> [options]
```

| Option        | Description                      |
| ------------- | -------------------------------- |
| `-q, --quiet` | Output `CID<tab>author` per line |

```bash
# Full change history
seed-cli document changes hm://z6Mk.../my-doc

# Compact: CID and author per line
seed-cli document changes hm://z6Mk.../my-doc -q
```

**Output includes:**

- Change ID (CID)
- Author account ID
- Dependencies (parent changes in the DAG)
- Create time
- Latest version CID

---

### document stats

Get interaction statistics for a document.

```
seed-cli document stats <id>
```

```bash
seed-cli document stats hm://z6Mk.../my-doc
```

**Output includes:**

- Citation count (incoming links)
- Comment count
- Change count (edit history)
- Child document count
- Per-block citation and comment counts

---

### document cid

Fetch a raw IPFS block by its CID.

```
seed-cli document cid <cid>
```

```bash
seed-cli document cid bafy2bzace...
```

Returns the decoded IPLD block data as JSON.

---

## Account Commands

All account commands live under `seed-cli account <subcommand>`.

### account get

Get account information.

```
seed-cli account get <uid> [options]
```

| Option        | Description                             |
| ------------- | --------------------------------------- |
| `-q, --quiet` | Print name only (or UID if no name set) |

```bash
# Full account info
seed-cli account get z6MkrbYs...

# Pretty print
seed-cli account get z6MkrbYs... --pretty

# Just the name
seed-cli account get z6MkrbYs... -q
```

---

### account list

List all known accounts on the server.

```
seed-cli account list [options]
```

| Option        | Description                   |
| ------------- | ----------------------------- |
| `-q, --quiet` | Output `ID<tab>name` per line |

```bash
# Full JSON
seed-cli account list

# Compact for scripting
seed-cli account list -q
```

---

### account contacts

List contacts for an account.

```
seed-cli account contacts <uid> [options]
```

| Option        | Description       |
| ------------- | ----------------- |
| `-q, --quiet` | Output names only |

```bash
seed-cli account contacts z6Mk...
seed-cli account contacts z6Mk... -q
```

---

### account capabilities

List access control capabilities for a resource.

```
seed-cli account capabilities <id>
```

```bash
seed-cli account capabilities hm://z6Mk...
```

**Output includes:** capability ID, issuer, delegate, role, path restrictions, recursive flag.

---

## Comment Commands

All comment commands live under `seed-cli comment <subcommand>`.

### comment get

Get a single comment by ID.

```
seed-cli comment get <id>
```

```bash
seed-cli comment get "hm://z6Mk...?c=bafy..."
```

---

### comment list

List all comments on a document.

```
seed-cli comment list <targetId> [options]
```

| Option        | Description                         |
| ------------- | ----------------------------------- |
| `-q, --quiet` | Output `ID<tab>authorName` per line |

```bash
seed-cli comment list hm://z6Mk.../my-doc
seed-cli comment list hm://z6Mk.../my-doc -q
```

---

### comment create

Create a comment on a document.

```
seed-cli comment create <targetId> [options]
```

| Option                | Description                              |
| --------------------- | ---------------------------------------- |
| `--body <text>`       | Comment text (inline)                    |
| `--file <path>`       | Read comment text from file              |
| `--reply <commentId>` | Reply to an existing comment (threading) |
| `-k, --key <name>`    | Signing key name or account ID           |

**Examples:**

```bash
# Top-level comment
seed-cli comment create hm://z6Mk.../my-doc --body "Great article!" --key reviewer

# Reply to a comment (creates a thread)
seed-cli comment create hm://z6Mk.../my-doc --body "Thanks!" --reply bafy... --key author

# Comment on a specific block (block-level annotation)
seed-cli comment create "hm://z6Mk.../my-doc#blk-abc123" --body "This paragraph needs work" --key editor

# Read comment from file
seed-cli comment create hm://z6Mk.../my-doc --file review.txt --key reviewer
```

**Inline mentions:**

Comment text supports inline mentions using the format `@[DisplayName](hm://accountId)`. Mentions are converted to
`Embed` annotations with a U+FFFC object replacement character.

```bash
seed-cli comment create hm://z6Mk.../doc --body "cc @[Alice](hm://z6MkAlice...)" --key bob
```

**Block-level comments:**

When the target ID includes a `#blockId` fragment, the comment body is automatically wrapped in an `Embed` block
referencing the specific block. This matches the behavior of the desktop and web apps for block-level annotations.

**Threading:**

When `--reply` is specified, the CLI fetches the parent comment to determine the thread root. If the parent is already a
reply, the thread root is inherited. Otherwise, the parent comment itself becomes the thread root.

---

### comment edit

Edit an existing comment.

```
seed-cli comment edit <commentId> [options]
```

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `--body <text>`    | Updated comment text (inline)  |
| `--file <path>`    | Read updated text from file    |
| `-k, --key <name>` | Signing key name or account ID |

**Examples:**

```bash
# Edit inline
seed-cli comment edit z6MkAuthor.../zb2rComment... --body "Updated wording" --key reviewer

# Edit from file
seed-cli comment edit z6MkAuthor.../zb2rComment... --file review-update.txt --key reviewer
```

The CLI preserves reply threading metadata for replies and keeps the block-level anchor wrapper for comments that were
originally attached to a specific block.

---

### comment delete

Delete a comment by publishing a tombstone.

```
seed-cli comment delete <commentId> [options]
```

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `-k, --key <name>` | Signing key name or account ID |

```bash
seed-cli comment delete bafy... --key reviewer
```

---

### comment discussions

List threaded discussions on a document.

```
seed-cli comment discussions <targetId> [options]
```

| Option               | Description                 |
| -------------------- | --------------------------- |
| `-c, --comment <id>` | Filter to a specific thread |

```bash
# All discussions
seed-cli comment discussions hm://z6Mk.../my-doc

# A specific thread
seed-cli comment discussions hm://z6Mk.../my-doc --comment bafy...
```

---

## Contact Commands

All contact commands live under `seed-cli contact <subcommand>`.

### contact create

Create a contact (a named reference to another account).

```
seed-cli contact create [options]
```

| Option                  | Description                                |
| ----------------------- | ------------------------------------------ |
| `--subject <accountId>` | **Required.** Account ID being described   |
| `--name <name>`         | **Required.** Display name for the contact |
| `-k, --key <name>`      | Signing key name or account ID             |

```bash
seed-cli contact create --subject z6MkAlice... --name "Alice" --key mykey
```

**Output:** Contact record ID in `authority/tsid` format.

---

### contact delete

Delete a contact by publishing a tombstone.

```
seed-cli contact delete <contactIdOrCid> [options]
```

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `-k, --key <name>` | Signing key name or account ID |

Accepts either a record ID (`authority/tsid`) or a CID. If given a CID, the CLI fetches the blob to compute the record
ID.

```bash
seed-cli contact delete z6Mk.../zQ3sh... --key mykey
seed-cli contact delete bafy... --key mykey
```

---

### contact list

List contacts for an account.

```
seed-cli contact list [accountId] [options]
```

| Option      | Description                                         |
| ----------- | --------------------------------------------------- |
| `--account` | Only show contacts signed by the account            |
| `--subject` | Only show contacts where the account is the subject |

By default, shows contacts in both directions (signed by and about the account).

```bash
# Both directions
seed-cli contact list z6Mk...

# Only contacts this account created
seed-cli contact list z6Mk... --account

# Only contacts about this account
seed-cli contact list z6Mk... --subject
```

---

## Capability Commands

All capability commands live under `seed-cli capability <subcommand>`.

### capability create

Create a capability (delegate access to another account).

```
seed-cli capability create [options]
```

| Option                   | Description                             |
| ------------------------ | --------------------------------------- |
| `--delegate <accountId>` | **Required.** Account receiving access  |
| `--role <role>`          | **Required.** Role: `WRITER` or `AGENT` |
| `--path <path>`          | Path scope for the capability           |
| `--label <label>`        | Human-readable label                    |
| `-k, --key <name>`       | Signing key name or account ID          |

```bash
# Grant full write access
seed-cli capability create --delegate z6MkBob... --role WRITER --key alice

# Grant write access scoped to a path
seed-cli capability create --delegate z6MkBot... --role AGENT --path /blog --label "Blog bot" --key alice
```

---

## Key Management Commands

All key commands live under `seed-cli key <subcommand>`. The `keys` alias also works.

Keys are stored in the **OS keyring** (macOS Keychain / Linux libsecret), shared with the Seed desktop app and Go
daemon. Keys created in the desktop app are immediately available to the CLI, and vice versa.

### key generate

Generate a new signing key from a BIP-39 mnemonic.

```
seed-cli key generate [options]
```

| Option                | Description                                       |
| --------------------- | ------------------------------------------------- |
| `-n, --name <name>`   | Key name (default: `main`)                        |
| `-w, --words <count>` | Mnemonic word count: `12` or `24` (default: `12`) |
| `--passphrase <pass>` | Optional BIP-39 passphrase                        |
| `--show-mnemonic`     | Display the mnemonic (save it securely!)          |

```bash
# Generate with default settings
seed-cli key generate

# Generate a named key with 24 words and show the mnemonic
seed-cli key generate -n secure-key --words 24 --show-mnemonic

# Generate with passphrase
seed-cli key generate -n protected --passphrase "my secret"
```

**Key name rules:** Only alphanumeric characters, hyphens, and underscores.

---

### key import

Import a key from an existing BIP-39 mnemonic.

```
seed-cli key import <mnemonic> [options]
```

| Option                | Description                    |
| --------------------- | ------------------------------ |
| `-n, --name <name>`   | Key name (default: `imported`) |
| `--passphrase <pass>` | Optional BIP-39 passphrase     |

```bash
seed-cli key import -n restored "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

seed-cli key import -n restored --passphrase "secret" "word1 word2 ... word12"
```

---

### key list

List all stored signing keys.

```
seed-cli key list
```

| Option        | Description                          |
| ------------- | ------------------------------------ |
| `-q, --quiet` | Output `name<tab>accountId` per line |

```bash
seed-cli key list
seed-cli key list -q
```

---

### key show

Show information for a specific key, or the default key if none specified.

```
seed-cli key show [nameOrId]
```

Accepts a key name or account ID.

```bash
# Show default key
seed-cli key show

# Show by name
seed-cli key show main

# Show by account ID
seed-cli key show z6Mk...
```

---

### key default

Set or show the default signing key.

```
seed-cli key default [nameOrId]
```

```bash
# Show current default
seed-cli key default

# Set a new default
seed-cli key default mykey
```

**Default key resolution order:**

1. Config `defaultAccount` (set by `key default`)
2. Key named `main`
3. First key in the keyring

---

### key remove

Remove a stored key.

```
seed-cli key remove <nameOrId> [options]
```

| Option        | Description       |
| ------------- | ----------------- |
| `-f, --force` | Skip confirmation |

```bash
# Shows warning, requires --force
seed-cli key remove mykey

# Actually remove
seed-cli key remove mykey --force
```

---

### key rename

Rename a stored key.

```
seed-cli key rename <currentName> <newName>
```

```bash
seed-cli key rename old-name new-name
```

---

### key derive

Derive an account ID from a mnemonic without storing the key.

```
seed-cli key derive <mnemonic> [options]
```

| Option                | Description                |
| --------------------- | -------------------------- |
| `--passphrase <pass>` | Optional BIP-39 passphrase |

```bash
seed-cli key derive "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
# Output: z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp
```

Useful for verifying a mnemonic maps to the expected account without writing it to the keyring.

---

## Search & Discovery Commands

These are top-level commands (not subcommands).

### search

Search for documents across the network.

```
seed-cli search <query> [options]
```

| Option                | Description                        |
| --------------------- | ---------------------------------- |
| `-a, --account <uid>` | Limit search to a specific account |
| `-q, --quiet`         | Output `ID<tab>title` per line     |

```bash
seed-cli search "artificial intelligence"
seed-cli search "meeting notes" --account z6Mk...
seed-cli search "project" -q
```

---

### query

List documents in a space (account).

```
seed-cli query <space> [options]
```

| Option              | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `-p, --path <path>` | Path prefix to filter                                               |
| `-m, --mode <mode>` | `Children` (default) or `AllDescendants`                            |
| `-l, --limit <n>`   | Maximum results                                                     |
| `--sort <term>`     | Sort by: `Path`, `Title`, `CreateTime`, `UpdateTime`, `DisplayTime` |
| `--reverse`         | Reverse sort order                                                  |
| `-q, --quiet`       | Output `ID<tab>name` per line                                       |

```bash
# List direct children
seed-cli query z6Mk...

# List all descendants recursively
seed-cli query z6Mk... --mode AllDescendants

# List children under a specific path
seed-cli query z6Mk... --path projects

# Sort by update time, newest first
seed-cli query z6Mk... --sort UpdateTime --reverse

# Limit to 5 results
seed-cli query z6Mk... --limit 5
```

---

### children

Shorthand for `query --mode Children`.

```
seed-cli children <space> [options]
```

| Option              | Description                   |
| ------------------- | ----------------------------- |
| `-p, --path <path>` | Path prefix                   |
| `-l, --limit <n>`   | Limit results                 |
| `-q, --quiet`       | Output `ID<tab>name` per line |

```bash
# These are equivalent:
seed-cli children z6Mk...
seed-cli query z6Mk... --mode Children
```

---

### citations

List documents that cite (link to) a given resource.

```
seed-cli citations <id> [options]
```

| Option        | Description            |
| ------------- | ---------------------- |
| `-q, --quiet` | Output source IDs only |

```bash
seed-cli citations hm://z6Mk.../my-doc
seed-cli citations hm://z6Mk.../my-doc -q
```

---

### activity

List recent activity events across the network.

```
seed-cli activity [options]
```

| Option                | Description                             |
| --------------------- | --------------------------------------- |
| `-l, --limit <n>`     | Page size                               |
| `-t, --token <token>` | Pagination token (from previous output) |
| `--authors <uids>`    | Filter by author UIDs (comma-separated) |
| `--resource <id>`     | Filter by resource                      |
| `-q, --quiet`         | Output event count + next token only    |

```bash
# Recent activity
seed-cli activity

# Paginate
seed-cli activity --limit 20
seed-cli activity --limit 20 --token <nextPageToken>

# Filter by author
seed-cli activity --authors z6Mk...

# Filter by resource
seed-cli activity --resource hm://z6Mk.../my-doc
```

---

## Hypermedia ID Format

Seed uses Hypermedia IDs (HM IDs) as universal resource identifiers:

```
hm://<uid>[/<path>][?v=<version>][?c=<commentCID>][#<blockRef>]
```

| Component    | Description                           | Example              |
| ------------ | ------------------------------------- | -------------------- |
| `uid`        | Account's Ed25519 public key ID       | `z6MkrbYsRzKb1VA...` |
| `path`       | Forward-slash-separated path segments | `/projects/alpha`    |
| `version`    | CID of a specific document version    | `?v=bafy2bzace...`   |
| `commentCID` | CID of a comment                      | `?c=bafy2bzace...`   |
| `blockRef`   | Specific block ID within the document | `#blk-abc123`        |

**Examples:**

```
hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou
hm://z6MkrbYs.../projects/alpha
hm://z6MkrbYs.../my-doc?v=bafy2bzacedfvn...
hm://z6MkrbYs.../my-doc#blk-abc123
hm://z6MkrbYs...?c=bafy2bzace...
```

The CLI also accepts bare UIDs (without the `hm://` prefix) in most places.

---

## Output Formats

### JSON (default)

Pretty-printed with 2-space indentation. BigInt values are serialized as strings.

```bash
seed-cli account list
```

```json
{
  "accounts": [
    {
      "id": {"id": "hm://z6Mk...", "uid": "z6Mk..."},
      "metadata": {"name": "Account Name"}
    }
  ]
}
```

### YAML

```bash
seed-cli account list --yaml
```

```yaml
accounts:
  - id:
      id: hm://z6Mk...
      uid: z6Mk...
    metadata:
      name: Account Name
```

### Pretty

Colorized JSON output:

- **Green:** strings
- **Yellow:** numbers
- **Blue:** booleans
- **Cyan:** object keys
- **Dim gray:** null

```bash
seed-cli account list --pretty
```

### Quiet

Tab-separated values, one record per line. Ideal for piping to `awk`, `cut`, `grep`, etc.

```bash
seed-cli account list -q
# hm://z6Mk...	Account Name
# hm://z6Mk...	Another Account
```

---

## Markdown Conversion

### Document to Markdown (`--md`)

When using `document get --md`, the CLI converts the internal block tree to GitHub-flavored Markdown:

| Block type    | Markdown rendering                                          |
| ------------- | ----------------------------------------------------------- |
| Heading       | `#`, `##`, `###`, etc. based on depth                       |
| Paragraph     | Plain text with inline formatting                           |
| Code          | Fenced code blocks with language tag                        |
| Math          | `$$...$$` LaTeX blocks                                      |
| Image         | `![alt](gateway-url)` (IPFS CIDs converted to gateway URLs) |
| Embed         | Blockquote with link (or inlined content with `--resolve`)  |
| Query         | Resolved to a list of linked documents (with `--resolve`)   |
| Button        | `[text](url)` link                                          |
| Bold          | `**text**`                                                  |
| Italic        | `*text*`                                                    |
| Code (inline) | `` `text` ``                                                |
| Link          | `[text](url)`                                               |

**Frontmatter (`--frontmatter`):**

```yaml
---
title: Document Title
summary: A brief description
version: bafy2bzace...
authors:
  - z6Mk...
---
```

**Resolve mode (`--resolve`):**

Fetches embedded documents and query results from the server and inlines their content directly in the Markdown output,
up to a default recursion depth of 2.

### Markdown to Blocks (input)

When creating or updating documents with `--body` or `--body-file`, the CLI parses Markdown into the internal block
tree:

| Markdown element     | Block type                                      |
| -------------------- | ----------------------------------------------- |
| `# Heading`          | `Heading` container with children               |
| Paragraphs           | `Paragraph` blocks                              |
| ` ```code``` `       | `Code` block with `language` attribute          |
| `**bold**`           | `Bold` annotation                               |
| `*italic*`           | `Italic` annotation                             |
| `` `code` ``         | `Code` annotation                               |
| `[text](url)`        | `Link` annotation                               |
| `- item` / `1. item` | Children with `childrenType: Unordered/Ordered` |

---

## Key Storage & Cryptography

### Where Keys Live

Keys are stored in the **OS keyring**, not on disk:

| Platform | Backend                          | CLI tool used |
| -------- | -------------------------------- | ------------- |
| macOS    | Keychain                         | `security`    |
| Linux    | D-Bus Secret Service (libsecret) | `secret-tool` |

The keyring is shared with the Go daemon and desktop app. Keys registered in any Seed application are available in all
others.

### Keyring Service Names

| Environment | Service Name       | Selected by         |
| ----------- | ------------------ | ------------------- |
| Production  | `seed-daemon-main` | Default             |
| Development | `seed-daemon-dev`  | `--dev` global flag |

### Key Encoding Format

Each key is stored as a 68-byte libp2p protobuf-encoded Ed25519 key pair, base64-encoded:

```
[08 01 12 40] [32-byte private seed] [32-byte public key]
 ─── header ───  ─── 64 bytes of key data ───
```

The 4-byte header is:

- `08 01` — protobuf field 1 (key type) = 1 (Ed25519)
- `12 40` — protobuf field 2 (key data) length = 64 bytes

### Account ID Derivation

```
32-byte Ed25519 public key
  ↓ prepend multicodec prefix [0xed, 0x01]
34-byte multicodec key
  ↓ base58btc encode (multibase prefix 'z')
Account ID string (starts with "z6Mk")
```

### Key Derivation from Mnemonic

```
BIP-39 Mnemonic + optional Passphrase
  ↓ bip39.mnemonicToSeedSync()
64-byte seed
  ↓ SLIP-10 derivation at path m/44'/104109'/0'
32-byte Ed25519 private key
  ↓ ed25519.getPublicKey()
32-byte Ed25519 public key
  ↓ computeAccountId()
Account ID (z6Mk...)
```

The derivation path `104109` is the Unicode codepoint sum for `h` + `m` (104 + 109).

### Cross-Format Compatibility

The keyring JSON payload uses two formats:

1. **Plain JSON** — written by the CLI
2. **`go-keyring-base64:<base64>`** — written by the Go daemon

The CLI reads both formats transparently. When writing, it uses the `go-keyring-base64:` format for compatibility with
the daemon.

---

## Signing & Blob Architecture

All mutable data in Seed is stored as signed CBOR blobs. The CLI creates and signs these blobs client-side before
publishing them to the server.

### Signing Process

1. Create the unsigned object with `sig: new Uint8Array(64)` (zeroed) and `ts: 0n`.
2. CBOR-encode the unsigned object.
3. Sign the CBOR bytes with Ed25519.
4. Fill in the actual `sig` and `ts` values.
5. CBOR-encode the final signed object.
6. Compute the SHA-256 CID of the encoded bytes.
7. Publish with the explicit CID.

### Blob Types

**Genesis Change:** The root of every document's change DAG.

```
{type: "Change", signer, sig, ts: 0n}
```

**Document Change:** Mutations to document content and metadata.

```
{type: "Change", signer, sig, ts, genesis: CID, deps: CID[], depth, body: {ops, opCount}}
```

**Version Ref:** Points clients to the current document head.

```
{type: "Ref", signer, sig, ts, space, path, genesis, version, generation}
```

**Tombstone Ref:** Marks a document as deleted.

**Redirect Ref:** Points one document to another.

**Comment:** A signed comment blob attached to a document version.

**Contact:** A named reference from one account to another.

**Capability:** A delegation of write or agent access.

### Document Operations

Changes contain arrays of operations:

| Operation       | Description                    |
| --------------- | ------------------------------ |
| `SetAttributes` | Set metadata key-value pairs   |
| `ReplaceBlock`  | Insert or replace a block      |
| `MoveBlocks`    | Move blocks under a new parent |
| `DeleteBlocks`  | Remove blocks by ID            |

---

## Environment Variables

| Variable      | Description                                          |
| ------------- | ---------------------------------------------------- |
| `SEED_SERVER` | Default server URL (overrides `https://hyper.media`) |

---

## Error Handling

**Exit codes:**

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| `0`  | Success                                               |
| `1`  | Error (invalid input, network error, not found, etc.) |

**Error output:** Errors are printed to stderr with a red `✗` prefix.

**Common errors:**

| Error                                                           | Cause                                              |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `Invalid Hypermedia ID`                                         | Malformed `hm://` URL                              |
| `API error (500): ...`                                          | Server-side error or resource not found            |
| `Key "name" not found`                                          | No key with that name or account ID in the keyring |
| `No signing keys found`                                         | Must run `key generate` or `key import` first      |
| `Cannot combine --body/--body-file with --blocks/--blocks-file` | Mutually exclusive options                         |

---

## Scripting Examples

### Export all documents as Markdown

```bash
#!/bin/bash
ACCOUNT="z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou"

seed-cli query "$ACCOUNT" --mode AllDescendants -q | while IFS=$'\t' read -r id name; do
  filename=$(echo "$name" | tr ' /' '_' | tr -cd '[:alnum:]_-')
  [ -z "$filename" ] && filename="unnamed_$(echo "$id" | md5sum | head -c 8)"
  seed-cli document get "$id" --md --resolve > "${filename}.md"
  echo "Exported: ${filename}.md"
done
```

### Create a document from a Markdown file

```bash
#!/bin/bash
ACCOUNT="z6Mk..."
TITLE="$(head -1 "$1" | sed 's/^# //')"

seed-cli document create "$ACCOUNT" \
  --title "$TITLE" \
  --body-file "$1" \
  --key main
```

### Batch update documents from local files

```bash
#!/bin/bash
for file in docs/*.md; do
  DOC_PATH=$(basename "$file" .md)
  ID="hm://z6Mk.../$DOC_PATH"
  echo "Updating $ID from $file"
  seed-cli document update "$ID" -f "$file" --key main
done
```

### Monitor activity feed

```bash
#!/bin/bash
TOKEN=""
while true; do
  if [ -n "$TOKEN" ]; then
    OUTPUT=$(seed-cli activity --limit 10 --token "$TOKEN")
  else
    OUTPUT=$(seed-cli activity --limit 10)
  fi
  echo "$OUTPUT" | jq '.events[] | "\(.eventType) by \(.author)"'
  TOKEN=$(echo "$OUTPUT" | jq -r '.nextPageToken // empty')
  sleep 60
done
```

### Find all documents by a specific author

```bash
#!/bin/bash
AUTHOR="z6Mk..."
seed-cli activity --authors "$AUTHOR" --limit 100 | jq -r '.events[].resource' | sort -u
```

### Delegate write access

```bash
#!/bin/bash
seed-cli capability create \
  --delegate z6MkBob... \
  --role WRITER \
  --key alice

seed-cli contact create \
  --subject z6MkBob... \
  --name "Bob" \
  --key alice
```

### Backup all keys (show mnemonics)

```bash
#!/bin/bash
seed-cli key list -q | while IFS=$'\t' read -r name id; do
  echo "=== Key: $name ($id) ==="
  seed-cli key show "$name"
  echo ""
done
```

---

## Development

```bash
cd frontend/apps/cli

# Run directly
bun run src/index.ts [command]

# Build for distribution
npm run build

# Type check
npm run typecheck

# Run fixture-based tests (starts a local daemon)
bun test src/test/cli-fixture.test.ts

# Run daemon integration tests
bun test src/test/cli.test.ts

# Run live server tests
bun test src/test/cli-live.test.ts
```

### Project Structure

```
frontend/apps/cli/
├── src/
│   ├── index.ts              # Entry point, global options, command registration
│   ├── client.ts             # HTTP API client
│   ├── config.ts             # ~/.seed/config.json management
│   ├── output.ts             # Output formatting (JSON, YAML, pretty, table)
│   ├── markdown.ts           # Document → Markdown conversion
│   ├── commands/
│   │   ├── document.ts       # document get/create/update/delete/fork/move/redirect/changes/stats/cid
│   │   ├── comment.ts        # comment get/list/create/delete/discussions
│   │   ├── capability.ts     # capability create
│   │   ├── contact.ts        # contact create/delete/list
│   │   ├── account.ts        # account get/list/contacts/capabilities
│   │   ├── key.ts            # key generate/import/list/show/default/remove/rename/derive
│   │   ├── search.ts         # search
│   │   └── query.ts          # query/children/citations/activity
│   ├── utils/
│   │   ├── keyring.ts        # Cross-platform OS keyring access
│   │   ├── key-derivation.ts # BIP-39/SLIP-10 key derivation
│   │   ├── signing.ts        # CBOR blob signing (genesis, changes)
│   │   ├── markdown.ts       # Markdown → blocks parser
│   │   ├── blocks-json.ts    # HMBlockNodes JSON parser
│   │   ├── block-diff.ts     # Smart block diffing for document update
│   │   ├── depth.ts          # Change DAG depth resolution
│   │   └── hm-id.ts          # Hypermedia ID pack/unpack
│   └── test/
│       ├── cli-fixture.test.ts  # Fixture-based integration tests
│       ├── cli.test.ts          # Daemon integration tests
│       └── cli-live.test.ts     # Live server tests
├── docs/
│   ├── API.md                # HTTP API reference
│   ├── KEYS.md               # Key management internals
│   ├── SIGNING.md            # Signing and blob creation reference
│   └── TYPES.md              # Type definitions reference
└── package.json
```

### Dependencies

| Package                   | Purpose                     |
| ------------------------- | --------------------------- |
| `commander`               | CLI framework               |
| `multiformats`            | CID/IPLD handling           |
| `@ipld/dag-cbor`          | CBOR encoding               |
| `@noble/ed25519`          | Ed25519 signatures          |
| `@noble/hashes`           | Cryptographic hashing       |
| `@exodus/slip10`          | SLIP-10 key derivation      |
| `bip39`                   | BIP-39 mnemonics            |
| `chalk`                   | Terminal colors             |
| `yaml`                    | YAML formatting             |
| `@seed-hypermedia/client` | SDK for document operations |

---

## Further Reading

- [API Reference](docs/API.md) — HTTP API endpoints
- [Key Management](docs/KEYS.md) — Keyring internals and cross-platform storage
- [Signing Reference](docs/SIGNING.md) — Blob signing and creation details
- [Types Reference](docs/TYPES.md) — Complete type definitions
- [Seed Hypermedia](https://seed.hyper.media) — Project website
- [GitHub Repository](https://github.com/seed-hypermedia/seed) — Source code
