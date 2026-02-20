---
name: seed-hypermedia-write
description: Write content to Seed Hypermedia documents and comments using the Seed CLI. Use when the user wants to create, update, or modify Seed documents or comments.
---

# Seed Hypermedia Write Skill

Scope: Write operations on Seed Hypermedia — creating/updating documents and creating comments. For read-only operations use the **seed-hypermedia-read** skill.

## Prerequisites

### 1. Check CLI Availability

The Seed CLI lives at `frontend/apps/cli/`. Check if it can run:

```bash
bun run frontend/apps/cli/src/index.ts --help
```

If dependencies are missing:

```bash
cd frontend/apps/cli && bun install
```

### 2. Check Available Keys

Keys are stored in the OS keyring, shared with the Seed daemon.

```bash
# List keys (production)
bun run frontend/apps/cli/src/index.ts key list

# List keys (development)
bun run frontend/apps/cli/src/index.ts key list --dev
```

If no keys exist, the user must import or generate one:

```bash
# Import from mnemonic (recovers existing account)
bun run frontend/apps/cli/src/index.ts key import -n mykey "word1 word2 ... word12"

# Generate a new key
bun run frontend/apps/cli/src/index.ts key generate -n mykey --show-mnemonic
```

### 3. Determine Environment

- **Production** (default): Uses `seed-daemon-main` keyring, targets `https://hyper.media`
- **Development** (`--dev`): Uses `seed-daemon-dev` keyring

Always ask the user which environment to use if unclear. Use `--dev` when testing.

## CLI Alias

For convenience in all examples below, define:

```bash
SEED_CLI="bun run frontend/apps/cli/src/index.ts"
```

Or run from the CLI directory:

```bash
cd frontend/apps/cli
bun run src/index.ts [command]
```

## Write Operations

### Create a New Document

Create a new document from markdown content:

```bash
$SEED_CLI document create <account> --path /my-document --body-file content.md --key <keyname>

# Development mode
$SEED_CLI document create <account> --path /my-doc --body-file content.md --key <keyname> --dev
```

**Parameters:**

- `<account>`: Account UID to create the document under (e.g., `z6Mk...`)
- `-p, --path <path>`: Document path (e.g. "my-document"). Auto-generated from title if omitted.
- `--title <title>`: Document title (overrides H1 from markdown).
- `--body <text>`: Markdown content inline.
- `--body-file <file>`: Read markdown content from a file.
- `-k, --key <name>`: Signing key name or account ID.
- `--dev`: Use development environment

**What happens internally:**

1. Creates three signed blobs: a genesis change (document identity anchor), a document change (content operations), and a ref (linking to path/account)
2. Pushes all blobs to the server automatically

### Update Document Metadata or Content

Update a document's title, summary, or append new content blocks:

```bash
$SEED_CLI document update <hm-id> --title "New Title" --key <keyname>
$SEED_CLI document update <hm-id> --summary "New summary" --key <keyname>
$SEED_CLI document update <hm-id> --title "Title" --summary "Summary" --key <keyname>
$SEED_CLI document update <hm-id> --body-file new-section.md --key <keyname>

# Append content under a specific parent block
$SEED_CLI document update <hm-id> --body-file content.md --parent <blockId> --key <keyname>

# Delete specific blocks
$SEED_CLI document update <hm-id> --delete-blocks "blockId1,blockId2" --key <keyname>

# Development mode
$SEED_CLI document update <hm-id> --title "Title" --key <keyname> --dev
```

**Parameters:**

- `<hm-id>`: Hypermedia ID of the document (e.g., `hm://z6Mk.../path`)
- `--title`: New document title (stored as `name` metadata)
- `--summary`: New document summary
- `--body <text>`: Markdown content to append inline
- `--body-file <file>`: Read markdown content to append from file
- `--parent <blockId>`: Parent block ID for new content (default: document root)
- `--delete-blocks <ids>`: Comma-separated block IDs to delete
- `-k, --key`: Name or account ID of the signing key. If omitted, uses the default key.
- `--dev`: Use development environment

**What happens internally:**

1. Fetches the document to get account, path, genesis CID
2. Lists all changes to compute the current depth in the DAG
3. Creates a signed Change blob with operations (SetAttributes, ReplaceBlock, MoveBlocks, DeleteBlock)
4. Creates a signed Ref blob pointing to the new change
5. Submits both via HTTP POST to the server

### Create a Comment

Create a comment on a document:

```bash
# Inline text
$SEED_CLI comment create <target-hm-id> --body "My comment" --key <keyname>

# From a file
$SEED_CLI comment create <target-hm-id> --file comment.md --key <keyname>

# Reply to an existing comment
$SEED_CLI comment create <target-hm-id> --body "Reply text" --reply <comment-id> --key <keyname>

# Development mode
$SEED_CLI comment create <target-hm-id> --body "Comment" --key <keyname> --dev
```

**Parameters:**

- `<target-hm-id>`: Hypermedia ID of the document to comment on
- `--body`: Comment text (inline)
- `--file`: Read comment text from a file
- `--reply`: Reply to an existing comment by its ID
- `-k, --key`: Signing key name or account ID
- `--dev`: Use development environment

## Workflow

### Standard Write Flow

1. **Read first** — Use the **seed-hypermedia-read** skill to fetch the document and understand its current state.

2. **Identify the key** — List available keys and confirm which one to use:

   ```bash
   $SEED_CLI key list --dev
   ```

3. **Make the change** — Use the appropriate write command:

   ```bash
   $SEED_CLI document update hm://z6Mk.../doc-path --title "Updated Title" --key z6Mk... --dev
   ```

4. **Verify** — Read the document again to confirm the change was applied.

### Finding Document IDs

If the user refers to a document by name rather than ID, use the read skill to search:

```bash
# Search for documents
$SEED_CLI search "document name" --server https://hyper.media

# List documents in a space
$SEED_CLI query z6Mk... --mode AllDescendants -q
```

## Error Handling

| Error                   | Cause                       | Fix                                                    |
| ----------------------- | --------------------------- | ------------------------------------------------------ |
| "No signing keys found" | No keys in keyring          | Run `$SEED_CLI key import` or `$SEED_CLI key generate` |
| "Key not found"         | Specified key doesn't exist | Check `$SEED_CLI key list` for available keys          |
| "No changes found"      | Document doesn't exist      | Verify the HM ID is correct                            |
| "API error (403)"       | Key lacks write permission  | Key must be the document owner or have a capability    |
| "API error (500)"       | Server-side error           | Check server URL, try again                            |

## Key Management

### List Keys

```bash
$SEED_CLI key list          # Production keyring
$SEED_CLI key list --dev    # Development keyring
```

### Import Key from Mnemonic

```bash
$SEED_CLI key import -n <name> "<12 or 24 word mnemonic>"
$SEED_CLI key import -n <name> --passphrase "optional" "<mnemonic>" --dev
```

### Generate New Key

```bash
$SEED_CLI key generate -n <name> --show-mnemonic
$SEED_CLI key generate -n <name> -w 24 --show-mnemonic --dev
```

### Show Key Details

```bash
$SEED_CLI key show <name-or-id>
$SEED_CLI key show  # Shows default key
```

### Remove Key

```bash
$SEED_CLI key remove <name-or-id> --force
```

## Hypermedia ID Format

```
hm://<account-uid>[/<path>][?v=<version>]
```

- `account-uid`: Public key ID (z6Mk...)
- `path`: Optional document path (e.g., `/projects/alpha`)
- `version`: Optional version CID

Examples:

```
hm://z6Mkon33EULrw7gnZHrcqX89W11NtEatDk6rnq2Qm7ysJwm4
hm://z6Mkon33EULrw7gnZHrcqX89W11NtEatDk6rnq2Qm7ysJwm4/my-document
```

## Key Rules

1. **Always use --dev for testing** — Never write to production without explicit user confirmation.
2. **Check key ownership** — The signing key must be the document owner's key or have a delegated capability.
3. **Read before writing** — Always fetch the document first to understand its current state.
4. **One operation at a time** — Don't batch multiple document updates in a single command.
5. **Verify after writing** — Read the document again to confirm changes applied correctly.
6. **Never expose mnemonics** — Don't log or display mnemonic phrases in output.

## Server Configuration

Default server: `https://hyper.media`

Override per-command:

```bash
$SEED_CLI --server http://localhost:4000 document update <hm-id> --title "Title"
```

Or set globally:

```bash
$SEED_CLI config --server http://localhost:4000
```

Environment variable:

```bash
SEED_SERVER=http://localhost:4000 $SEED_CLI document update <hm-id> --title "Title"
```
