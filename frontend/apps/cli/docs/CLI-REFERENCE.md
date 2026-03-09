---
name: seed-hypermedia
description: Access content on the Hypermedia Network using Seed Hypermedia CLI.
  Read and interact with URLs that are prefixed with hm://
---

## Overview

The Seed CLI is a command-line interface for interacting with the Seed Hypermedia network. It allows you to fetch documents, search content, manage accounts, create and update documents, manage comments, contacts, capabilities, and signing keys.

Seed servers are open source and self-hostable servers running on the peer-to-peer Hypermedia network. You can use the CLI to interact with any Seed server using its API.

Browse the open source Seed Hypermedia repository here: https://github.com/seed-hypermedia/seed

Learn more at https://seed.hyper.media

Download the Seed desktop app: https://download.seed.hyper.media

## Installation

You can run the Seed CLI directly using npx without installation:

```bash
npx -y @seed-hypermedia/cli
```

## URL Types

You should ALWAYS use this skill to open hm:// URLs. The CLI can be used once you have a URL with the prefix of hm://

Many https:// web sites are actually Hypermedia-enabled! If the user says that a URL is a Hypermedia URL or a Seed Site, then you should resolve the URL using this approach.

### HTTPS -> HM URL conversion

For an example HTTPS URL such as https://seed.hyper.media/community

Run this command to query for Hypermedia headers:

```sh
curl https://seed.hyper.media/community -X OPTIONS -I 2>&1 | grep -i x-hypermedia
```

Example headers might look like this:

```
x-hypermedia-authors: hm%3A%2F%2Fz6MkpHiG87oJnyMajxKyJcEwNRTbrHWjKSnmVxuuxq7bP3nb
x-hypermedia-id: hm%3A%2F%2Fz6MkpHiG87oJnyMajxKyJcEwNRTbrHWjKSnmVxuuxq7bP3nb
x-hypermedia-title: Lunaticoin
x-hypermedia-type: Document
x-hypermedia-version: bafy2bzacecf3jzmqao7zppmemna3ioz4p4nek37knlygr6n5rssdzhlikvkck
```

The headers are URL encoded but you can see the hm:// URL is available in `x-hypermedia-id:` . Now you can use that URL with the CLI.

## Global Options

- `-V, --version`: Output the version number
- `-s, --server <url>`: Server URL (default: "https://hyper.media")
- `--json`: JSON output (default)
- `--yaml`: YAML output
- `--pretty`: Pretty formatted output
- `-q, --quiet`: Minimal output
- `--dev`: Use development keyring (seed-daemon-dev)
- `-h, --help`: Display help for command

## Commands

### Document Operations

#### `document get <id>` - Fetch a document, comment, or entity

Fetch content by Hypermedia ID. Supports documents, comments, and entities.

**Options:**

- `-m, --metadata`: Fetch metadata only
- `--md`: Output as markdown
- `--frontmatter`: Include YAML frontmatter (with --md)
- `-r, --resolve`: Resolve embeds, mentions, and queries (with --md)
- `-q, --quiet`: Output minimal info

**Example:**

```bash
npx -y @seed-hypermedia/cli document get --md "hm://HYPERMEDIA_URL_HERE"
```

#### `document create <account>` - Create a new document

Create a new document from markdown or HMBlockNodes JSON.

**Options:**

- `--title <title>`: **Required.** Document title
- `-p, --path <path>`: Document path (default: slugified title)
- `--body <text>`: Markdown content (inline)
- `--body-file <file>`: Read markdown from file
- `--blocks <json>`: HMBlockNodes JSON (inline)
- `--blocks-file <file>`: Read HMBlockNodes JSON from file
- `-k, --key <name>`: Signing key name or account ID

**Example:**

```bash
npx -y @seed-hypermedia/cli document create z6Mk... --title "My Document" --body "Hello world" --key main
```

#### `document update <id>` - Update a document

Update document metadata, append content, replace content, or delete blocks.

**Options:**

- `--title <title>`: Set document title
- `--summary <summary>`: Set document summary
- `--body <text>`: Markdown content to append
- `--body-file <file>`: Read markdown to append from file
- `--replace-body <file>`: Replace entire body from file (smart diff)
- `--parent <blockId>`: Parent block for new content
- `--delete-blocks <ids>`: Comma-separated block IDs to delete
- `-k, --key <name>`: Signing key name or account ID

#### `document delete <id>` - Delete a document

Publish a tombstone ref to mark a document as deleted.

**Options:**

- `-k, --key <name>`: Signing key name or account ID

#### `document fork <sourceId> <destinationId>` - Fork a document

Copy a document to a new location without creating a redirect at the source.

**Options:**

- `-k, --key <name>`: Signing key name or account ID

#### `document move <sourceId> <destinationId>` - Move a document

Move a document: creates a copy at the destination and a redirect at the source.

**Options:**

- `-k, --key <name>`: Signing key name or account ID

#### `document redirect <id>` - Create a redirect

Create a redirect from one document to another.

**Options:**

- `--to <targetId>`: **Required.** Target Hypermedia ID
- `--republish`: Republish target content at this location
- `-k, --key <name>`: Signing key name or account ID

#### `document changes <targetId>` - List change history

List the version DAG for a document.

**Options:**

- `-q, --quiet`: Output CIDs and authors only

#### `document stats <id>` - Get interaction statistics

Get citation, comment, change, and child counts for a document.

#### `document cid <cid>` - Fetch raw IPFS block by CID

Retrieve and decode a raw IPFS block by its Content Identifier.

### Account Management

#### `account get <uid>` - Get account information

**Options:**

- `-q, --quiet`: Output name only

#### `account list` - List all known accounts

**Options:**

- `-q, --quiet`: Output IDs and names only

#### `account contacts <uid>` - List contacts for an account

**Options:**

- `-q, --quiet`: Output names only

#### `account capabilities <id>` - List access control capabilities

View delegated access permissions for a resource.

### Comment Operations

#### `comment get <id>` - Get a single comment

#### `comment list <targetId>` - List comments on a document

**Options:**

- `-q, --quiet`: Output IDs and authors only

#### `comment create <targetId>` - Create a comment

**Options:**

- `--body <text>`: Comment text
- `--file <path>`: Read comment from file
- `--reply <commentId>`: Reply to an existing comment (threading)
- `-k, --key <name>`: Signing key name or account ID

Supports inline mentions: `@[DisplayName](hm://accountId)`.
Supports block-level comments: target a specific block with `#blockId` in the URL.

#### `comment delete <commentId>` - Delete a comment

**Options:**

- `-k, --key <name>`: Signing key name or account ID

#### `comment discussions <targetId>` - List threaded discussions

**Options:**

- `-c, --comment <id>`: Filter to specific thread

### Contact Operations

#### `contact create` - Create a contact

**Options:**

- `--subject <accountId>`: **Required.** Account ID being described
- `--name <name>`: **Required.** Display name
- `-k, --key <name>`: Signing key name or account ID

#### `contact delete <contactIdOrCid>` - Delete a contact

Accepts record ID (authority/tsid) or CID.

**Options:**

- `-k, --key <name>`: Signing key name or account ID

#### `contact list [accountId]` - List contacts

**Options:**

- `--account`: Only contacts signed by the account
- `--subject`: Only contacts where the account is the subject

### Capability Operations

#### `capability create` - Delegate access

**Options:**

- `--delegate <accountId>`: **Required.** Account receiving access
- `--role <role>`: **Required.** `WRITER` or `AGENT`
- `--path <path>`: Path scope
- `--label <label>`: Human-readable label
- `-k, --key <name>`: Signing key name or account ID

### Search and Query

#### `search <query>` - Search for documents

**Options:**

- `-a, --account <uid>`: Limit search to specific account
- `-q, --quiet`: Output IDs and titles only

#### `query <space>` - List documents in a space

**Options:**

- `-p, --path <path>`: Path prefix
- `-m, --mode <mode>`: Query mode: `Children` (default) or `AllDescendants`
- `-l, --limit <n>`: Limit results
- `--sort <term>`: Sort by: `Path`, `Title`, `CreateTime`, `UpdateTime`, `DisplayTime`
- `--reverse`: Reverse sort order
- `-q, --quiet`: Output IDs and names only

#### `children <space>` - List child documents

Shorthand for `query --mode Children`.

**Options:**

- `-p, --path <path>`: Path prefix
- `-l, --limit <n>`: Limit results
- `-q, --quiet`: Output IDs and names only

#### `citations <id>` - List citing documents

**Options:**

- `-q, --quiet`: Output source IDs only

### Activity and History

#### `activity` - List activity events

**Options:**

- `-l, --limit <n>`: Page size
- `-t, --token <token>`: Pagination token
- `--authors <uids>`: Filter by author UIDs (comma-separated)
- `--resource <id>`: Filter by resource
- `-q, --quiet`: Output summary only

### Key Management

Keys are stored in the **OS keyring** (macOS Keychain / Linux libsecret), shared with the Seed desktop app and daemon.

#### `key generate` - Generate a new signing key

**Options:**

- `-n, --name <name>`: Key name (default: "main")
- `-w, --words <count>`: Mnemonic word count: 12 or 24 (default: "12")
- `--passphrase <pass>`: Optional BIP-39 passphrase
- `--show-mnemonic`: Display the mnemonic (save securely!)

#### `key import <mnemonic>` - Import from mnemonic

**Options:**

- `-n, --name <name>`: Key name (default: "imported")
- `--passphrase <pass>`: Optional BIP-39 passphrase

#### `key list` - List stored keys

#### `key show [nameOrId]` - Show key info

#### `key default [nameOrId]` - Set or show default key

#### `key remove <nameOrId>` - Remove a key

**Options:**

- `-f, --force`: Skip confirmation

#### `key rename <currentName> <newName>` - Rename a key

#### `key derive <mnemonic>` - Derive account ID without storing

**Options:**

- `--passphrase <pass>`: Optional BIP-39 passphrase

### Configuration

#### `config` - Manage CLI configuration

**Options:**

- `--server <url>`: Set default server URL
- `--show`: Show current configuration

## Common Use Cases

### Reading a Document as Markdown

```bash
npx -y @seed-hypermedia/cli document get --md "hm://document-id-here"
```

### Reading with Full Context Resolution

```bash
npx -y @seed-hypermedia/cli document get --md --resolve --frontmatter "hm://document-id-here"
```

### Creating a Document

```bash
npx -y @seed-hypermedia/cli document create z6Mk... --title "My Doc" --body-file content.md --key main
```

### Updating a Document

```bash
npx -y @seed-hypermedia/cli document update hm://z6Mk.../my-doc --replace-body updated.md --key main
```

### Searching for Content

```bash
npx -y @seed-hypermedia/cli search "your search terms"
```

### Listing Documents in a Space

```bash
npx -y @seed-hypermedia/cli query "space-id" --sort UpdateTime --reverse
```

### Getting Account Information

```bash
npx -y @seed-hypermedia/cli account get "account-uid"
```

### Creating and Managing Comments

```bash
# Create a comment
npx -y @seed-hypermedia/cli comment create "hm://z6Mk.../doc" --body "Great work!" --key main

# Reply to a comment
npx -y @seed-hypermedia/cli comment create "hm://z6Mk.../doc" --body "Thanks!" --reply bafy... --key main

# List comments
npx -y @seed-hypermedia/cli comment list "hm://z6Mk.../doc"
```

### Managing Keys

```bash
# Generate a new key and show the mnemonic
npx -y @seed-hypermedia/cli key generate --name mykey --show-mnemonic

# Import an existing mnemonic
npx -y @seed-hypermedia/cli key import -n imported "word1 word2 ... word12"

# List all keys
npx -y @seed-hypermedia/cli key list

# Derive account ID without storing
npx -y @seed-hypermedia/cli key derive "word1 word2 ... word12"
```

### Delegating Access

```bash
npx -y @seed-hypermedia/cli capability create --delegate z6MkBob... --role WRITER --key alice
```

## Output Formats

The CLI supports multiple output formats:

- **JSON** (default): Machine-readable structured data
- **YAML**: Human-readable structured data (`--yaml`)
- **Pretty**: Colorized formatted output (`--pretty`)
- **Markdown**: For documents (`--md` with document get)
- **Quiet**: Minimal tab-separated output (`--quiet`)

## Server Configuration

By default, the CLI connects to `https://hyper.media`. You can:

- Use a different server for a single command: `-s, --server <url>`
- Set a default server: `config --server <url>`
- Set via environment variable: `SEED_SERVER=https://...`
- View current configuration: `config --show`
