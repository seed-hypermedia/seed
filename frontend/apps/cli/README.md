# Seed Hypermedia CLI

A command-line interface for interacting with the Seed Hypermedia network. Query
documents, manage accounts, search content, and work with decentralized
hypermedia from your terminal.

## Installation

```bash
# Install globally via npm
npm install -g @seed-hypermedia/cli

# Or run directly with npx
npx @seed-hypermedia/cli --help
```

### Development Mode

```bash
# From the CLI directory
cd frontend/apps/cli

# Run directly with bun
bun run src/index.ts [command]

# Or use the dev script
bun run dev [command]
```

## Quick Start

```bash
# List all known accounts
seed-cli accounts

# Get a document
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Search for content
seed-cli search "climate change"

# Get document as markdown
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --md
```

---

## Global Options

These options work with all commands:

| Option               | Description                                 |
| -------------------- | ------------------------------------------- |
| `-s, --server <url>` | Server URL (default: `https://hyper.media`) |
| `--json`             | Output as JSON (default)                    |
| `--yaml`             | Output as YAML                              |
| `--pretty`           | Pretty formatted output                     |
| `-q, --quiet`        | Minimal output (IDs and names only)         |
| `-V, --version`      | Display version                             |
| `-h, --help`         | Display help                                |

### Examples

```bash
# Use a different server
seed-cli --server http://localhost:4000 accounts

# Get YAML output
seed-cli accounts --yaml

# Get pretty-printed JSON
seed-cli account z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --pretty

# Quiet mode for scripting
seed-cli accounts -q
```

### Environment Variables

| Variable      | Description        |
| ------------- | ------------------ |
| `SEED_SERVER` | Default server URL |

---

## Configuration

The CLI stores configuration in `~/.seed/config.json`.

### Show Configuration

```bash
seed-cli config --show
```

### Set Default Server

```bash
seed-cli config --server https://hyper.media
```

---

## Document Commands

### `seed-cli get <id>`

Fetch a document, comment, or entity by Hypermedia ID.

**Options:**

| Option           | Description                                         |
| ---------------- | --------------------------------------------------- |
| `-m, --metadata` | Fetch metadata only (faster)                        |
| `--md`           | Output as Markdown                                  |
| `--frontmatter`  | Include YAML frontmatter (with `--md`)              |
| `-r, --resolve`  | Resolve embeds, mentions, and queries (with `--md`) |
| `-q, --quiet`    | Output minimal info                                 |

**Examples:**

```bash
# Get document as JSON
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Get document as Markdown
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --md

# Get Markdown with frontmatter metadata
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --md --frontmatter

# Resolve all embeds and queries in the document
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --md --resolve

# Get just the metadata (name, summary, etc.)
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -m

# Get a specific version of a document
seed-cli get "hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou?v=bafy..."

# Get a child document at a path
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou/child-path

# Quiet mode: just print the document title
seed-cli get hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -q
```

### Markdown Output

When using `--md`, the CLI converts documents to GitHub-flavored Markdown:

- **Headings** are converted to `#`, `##`, etc.
- **Bold/Italic/Code** annotations are preserved
- **Links** are converted to `[text](url)` format
- **Images** become `![alt](url)` with IPFS URLs converted to gateway URLs
- **Code blocks** include language syntax highlighting markers
- **Math blocks** are wrapped in `$$...$$` (LaTeX)
- **Embeds** show as quoted blocks with links
- **Queries** are resolved to lists of linked documents (with `--resolve`)

### `seed-cli cid <cid>`

Fetch raw IPFS block data by CID.

```bash
seed-cli cid bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
```

### `seed-cli stats <id>`

Get interaction statistics for a document.

```bash
seed-cli stats hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou
```

**Output includes:**

- Citation count
- Comment count
- Change count
- Child document count
- Per-block citation and comment counts

---

## Account Commands

### `seed-cli accounts`

List all known accounts on the server.

```bash
# Full JSON output
seed-cli accounts

# Compact output: ID<tab>name per line
seed-cli accounts -q

# As YAML
seed-cli accounts --yaml
```

### `seed-cli account <uid>`

Get detailed information about a specific account.

```bash
# Get account info
seed-cli account z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Pretty print
seed-cli account z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --pretty

# Just the name (or ID if no name)
seed-cli account z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -q
```

### `seed-cli contacts <uid>`

List contacts for an account.

```bash
# Full output
seed-cli contacts z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Just names
seed-cli contacts z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -q
```

---

## Search Commands

### `seed-cli search <query>`

Search for documents across the network.

**Options:**

| Option                | Description                        |
| --------------------- | ---------------------------------- |
| `-a, --account <uid>` | Limit search to a specific account |
| `-q, --quiet`         | Output ID and title only           |

**Examples:**

```bash
# Search all documents
seed-cli search "artificial intelligence"

# Search within a specific account
seed-cli search "meeting notes" --account z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Compact output for scripting
seed-cli search "project" -q
```

---

## Query Commands

### `seed-cli query <space>`

List documents in a space (account).

**Options:**

| Option              | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `-p, --path <path>` | Path prefix to filter                                               |
| `-m, --mode <mode>` | `Children` (default) or `AllDescendants`                            |
| `-l, --limit <n>`   | Maximum results                                                     |
| `--sort <term>`     | Sort by: `Path`, `Title`, `CreateTime`, `UpdateTime`, `DisplayTime` |
| `--reverse`         | Reverse sort order                                                  |
| `-q, --quiet`       | Output ID and name only                                             |

**Examples:**

```bash
# List direct children of an account
seed-cli query z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# List all descendants recursively
seed-cli query z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --mode AllDescendants

# List children under a specific path
seed-cli query z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --path projects

# Sort by update time (newest first)
seed-cli query z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --sort UpdateTime --reverse

# Limit to 5 results
seed-cli query z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --limit 5

# Compact output
seed-cli query z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -q
```

### `seed-cli children <space>`

Shorthand for `query --mode Children`.

```bash
# These are equivalent:
seed-cli children z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou
seed-cli query z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --mode Children
```

### `seed-cli citations <id>`

List documents that cite (link to) a given resource.

```bash
# Full output
seed-cli citations hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Just source IDs
seed-cli citations hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -q
```

### `seed-cli capabilities <id>`

List access control capabilities for a document.

```bash
seed-cli capabilities hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou
```

**Output includes:**

- Capability ID
- Issuer (who granted the capability)
- Delegate (who received the capability)
- Role (Writer, Editor, etc.)
- Path restrictions
- Whether it's recursive

---

## Comments Commands

### `seed-cli comments <targetId>`

List all comments on a document.

```bash
# Full output
seed-cli comments hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Compact: ID<tab>author per line
seed-cli comments hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -q
```

### `seed-cli discussions <targetId>`

List threaded discussions on a document.

**Options:**

| Option               | Description                 |
| -------------------- | --------------------------- |
| `-c, --comment <id>` | Filter to a specific thread |

```bash
# All discussions
seed-cli discussions hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Specific thread
seed-cli discussions hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou --comment bafy...
```

### `seed-cli comment <id>`

Get a single comment by its ID.

```bash
seed-cli comment hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou?c=bafy...
```

---

## Activity Commands

### `seed-cli activity`

List recent activity events across the network.

**Options:**

| Option                | Description                             |
| --------------------- | --------------------------------------- |
| `-l, --limit <n>`     | Page size                               |
| `-t, --token <token>` | Pagination token                        |
| `--authors <uids>`    | Filter by author UIDs (comma-separated) |
| `--resource <id>`     | Filter by resource                      |
| `-q, --quiet`         | Summary output only                     |

**Examples:**

```bash
# Recent activity
seed-cli activity

# Limit to 10 events
seed-cli activity --limit 10

# Filter by author
seed-cli activity --authors z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Filter by resource
seed-cli activity --resource hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Paginate through results
seed-cli activity --limit 20
# ... note the nextPageToken in output ...
seed-cli activity --limit 20 --token <nextPageToken>
```

---

## Changes Commands

### `seed-cli changes <targetId>`

List the change history (versions) of a document.

```bash
# Full output
seed-cli changes hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Compact: CID<tab>author per line
seed-cli changes hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou -q
```

**Output includes:**

- Change ID (CID)
- Author
- Dependencies (parent changes)
- Create time
- Latest version CID

---

## Key Management Commands

Local key management for signing documents. Keys are stored in
`~/.seed/keys.json`.

### `seed-cli key generate`

Generate a new signing key from a BIP-39 mnemonic.

**Options:**

| Option                | Description                                 |
| --------------------- | ------------------------------------------- |
| `-n, --name <name>`   | Name for the key (default: "default")       |
| `-w, --words <count>` | Mnemonic word count: 12 or 24 (default: 12) |
| `--passphrase <pass>` | Optional BIP-39 passphrase                  |
| `--show-mnemonic`     | Display the mnemonic (save it securely!)    |

**Examples:**

```bash
# Generate a new key
seed-cli key generate -n myaccount

# Generate with 24 words and show mnemonic
seed-cli key generate -n secure-key --words 24 --show-mnemonic

# Generate with passphrase
seed-cli key generate -n passphrase-protected --passphrase "my secret"
```

### `seed-cli key import`

Import an existing key from a mnemonic.

**Options:**

| Option                | Description                            |
| --------------------- | -------------------------------------- |
| `-n, --name <name>`   | Name for the key (default: "imported") |
| `--passphrase <pass>` | Optional BIP-39 passphrase             |

```bash
# Import a 12-word mnemonic
seed-cli key import -n restored "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

# Import with passphrase
seed-cli key import -n restored --passphrase "my secret" "word1 word2 ... word12"
```

### `seed-cli key list`

List all stored signing keys.

```bash
seed-cli key list

# Just names
seed-cli key list -q
```

### `seed-cli key show [nameOrId]`

Show details for a specific key (or default key if none specified).

**Options:**

| Option            | Description                        |
| ----------------- | ---------------------------------- |
| `--show-mnemonic` | Also display the mnemonic (DANGER) |

```bash
# Show default key
seed-cli key show

# Show specific key
seed-cli key show myaccount

# Show with mnemonic (be careful!)
seed-cli key show myaccount --show-mnemonic
```

### `seed-cli key default [nameOrId]`

Set or show the default signing key.

```bash
# Show current default
seed-cli key default

# Set default
seed-cli key default myaccount
```

### `seed-cli key remove <nameOrId>`

Remove a stored key.

**Options:**

| Option        | Description       |
| ------------- | ----------------- |
| `-f, --force` | Skip confirmation |

```bash
# Will show warning and require --force
seed-cli key remove myaccount

# Actually remove it
seed-cli key remove myaccount --force
```

### `seed-cli key derive`

Derive an account ID from a mnemonic without storing the key.

```bash
seed-cli key derive "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
# Output: z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp

# With passphrase
seed-cli key derive --passphrase "secret" "word1 word2 ... word12"
```

---

## Hypermedia ID Format

Seed uses Hypermedia IDs (HM IDs) to reference documents:

```
hm://<account-uid>[/<path>][?v=<version>][#<block-ref>]
```

**Components:**

| Component     | Description                                      |
| ------------- | ------------------------------------------------ |
| `account-uid` | The account's public key ID (z6Mk...)            |
| `path`        | Optional path segments (e.g., `/projects/alpha`) |
| `version`     | Optional version CID (`?v=bafy...`)              |
| `block-ref`   | Optional block reference (`#block-id`)           |

**Examples:**

```bash
# Account home document
hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou

# Child document
hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou/projects/alpha

# Specific version
hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou?v=bafy2bzacedfvnsgafyaocwbf7gnszzc576thsuxprntawefhhprdi2mlplbo4

# Block reference
hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou#block-abc123

# Comment reference
hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou?c=bafy...
```

---

## Scripting Examples

### Export all documents as Markdown

```bash
#!/bin/bash
ACCOUNT="z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou"

# Get all document IDs
seed-cli query "$ACCOUNT" --mode AllDescendants -q | while IFS=$'\t' read -r id name; do
  # Create filename from name or path
  filename=$(echo "$name" | tr ' /' '_' | tr -cd '[:alnum:]_-')
  [ -z "$filename" ] && filename="unnamed_$(echo $id | md5sum | head -c 8)"

  # Export as markdown
  seed-cli get "$id" --md --resolve > "${filename}.md"
  echo "Exported: ${filename}.md"
done
```

### Monitor activity feed

```bash
#!/bin/bash
while true; do
  seed-cli activity --limit 5 -q
  sleep 60
done
```

### Backup all keys

```bash
#!/bin/bash
seed-cli key list -q | while read name; do
  echo "=== Key: $name ==="
  seed-cli key show "$name" --show-mnemonic
  echo ""
done
```

### Find documents by author

```bash
#!/bin/bash
AUTHOR="z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou"

seed-cli activity --authors "$AUTHOR" --limit 100 | jq -r '.events[].resource' | sort -u
```

### Check if document exists

```bash
#!/bin/bash
if seed-cli get "$1" -q 2>/dev/null | grep -q "not-found"; then
  echo "Document not found"
  exit 1
else
  echo "Document exists"
  exit 0
fi
```

---

## Output Formats

### JSON (default)

```bash
seed-cli accounts
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
seed-cli accounts --yaml
```

```yaml
accounts:
  - id:
      id: hm://z6Mk...
      uid: z6Mk...
    metadata:
      name: Account Name
```

### Pretty JSON

```bash
seed-cli accounts --pretty
```

Outputs indented, colorized JSON for readability.

### Quiet Mode

```bash
seed-cli accounts -q
```

```
hm://z6Mk...	Account Name
hm://z6Mk...	Another Account
```

Tab-separated values, one per line. Ideal for piping to other tools.

---

## Error Handling

The CLI uses standard exit codes:

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | Success                                               |
| 1    | Error (invalid input, network error, not found, etc.) |

Errors are printed to stderr with a descriptive message:

```bash
$ seed-cli get hm://invalid
Error: Invalid Hypermedia ID

$ seed-cli account nonexistent
Error: API error (500): Account not found
```

---

## Data Storage

| Path                  | Contents                                        |
| --------------------- | ----------------------------------------------- |
| `~/.seed/config.json` | CLI configuration (server URL, default account) |
| `~/.seed/keys.json`   | Stored signing keys (mnemonics, account IDs)    |

Files are created with mode `0600` (owner read/write only) for security.

---

## Development

```bash
# Run in development
bun run dev

# Build for distribution
npm run build

# Type check
npm run typecheck

# Run tests
bun test src/test/cli-live.test.ts
```

---

## License

MIT
