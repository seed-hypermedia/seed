---
name: seed-hypermedia-write
description:
  Write content to Seed Hypermedia documents and comments using the Seed CLI. Use when the user wants to create, update,
  or modify Seed documents or comments.
---

# Seed Hypermedia Write Skill

Scope: Write operations on Seed Hypermedia — creating/updating documents and creating comments. For read-only operations
use the **seed-hypermedia-read** skill. For LLM-powered PDF import see the **seed-pdf-import** skill.

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

Keys are stored in the OS keyring, shared with the Seed daemon. The account ID is derived automatically from the signing
key.

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

## Content Input

The CLI accepts content via the `-f` flag or stdin. Format is auto-detected:

| Source                        | Format detection                                                |
| ----------------------------- | --------------------------------------------------------------- |
| `-f file.md` or `-f file.txt` | Markdown                                                        |
| `-f file.json`                | JSON blocks (HMBlockNode[])                                     |
| `-f file.pdf`                 | PDF (extracted via pdfjs/GROBID)                                |
| Piped stdin                   | `[` or `{` first char → JSON; `%PDF` magic → PDF; else markdown |

### Markdown with Frontmatter (Preferred)

The simplest way to create rich documents is markdown with YAML frontmatter. Frontmatter keys map 1:1 to `HMMetadata`
field names:

```markdown
---
name: My Document Title
summary: A brief description of the document
displayAuthor: Jane Doe, John Smith
displayPublishTime: 2025-03-01
cover: file://./cover.png
icon: ipfs://bafkrei...
showOutline: true
---

# Introduction

This is a **bold** paragraph with a [link](https://example.com).

## Section One

- First item
- Second item

![Architecture diagram](./figures/arch.png)
```

Supported frontmatter keys: `name`, `summary`, `displayAuthor`, `displayPublishTime`, `icon`, `cover`, `siteUrl`,
`layout`, `showOutline`, `showActivity`, `contentWidth` (S/M/L), `seedExperimentalLogo`, `seedExperimentalHomeOrder`
(UpdatedFirst/CreatedFirst), `importCategories`, `importTags`, `theme` (object with `headerLayout`).

CLI flags override frontmatter values. Frontmatter values override PDF-extracted metadata.

### JSON Blocks

For precise control over the block tree structure, use JSON. See
[references/seed-document-format.md](references/seed-document-format.md) for the complete block format reference.

```bash
$SEED_CLI document create -f blocks.json --name "Title" --key mykey
```

## Write Operations

### Create a New Document

The account ID is derived automatically from the signing key — no positional argument needed.

```bash
# From a markdown file
$SEED_CLI document create -f content.md --key mykey

# From markdown with explicit metadata flags (override frontmatter)
$SEED_CLI document create -f content.md --name "My Document" --summary "Description" --key mykey

# From JSON blocks
$SEED_CLI document create -f blocks.json --name "Title" --key mykey

# From stdin (piped markdown)
echo "# Hello World" | $SEED_CLI document create --name "Hello" --key mykey

# PDF import (built-in extraction)
$SEED_CLI document create -f paper.pdf --key mykey

# With GROBID for better PDF extraction
$SEED_CLI document create -f paper.pdf --grobid-url http://localhost:8070 --key mykey

# Preview PDF extraction without publishing
$SEED_CLI document create -f paper.pdf --dry-run

# Custom path and development mode
$SEED_CLI document create -f content.md -p my-document --key mykey --dev
```

**Parameters:**

- `-f, --file <path>`: Input file (format detected by extension: `.md`, `.json`, `.pdf`)
- `-p, --path <path>`: Document path (e.g. "my-document"). Auto-generated from name if omitted.
- `-k, --key <name>`: Signing key name or account ID
- `--dry-run`: Preview extracted content without publishing
- `--grobid-url <url>`: GROBID server URL for enhanced PDF extraction
- `--dev`: Use development environment

**Metadata flags** (override frontmatter and PDF-extracted values):

| Flag                                     | Metadata key                | Description                           |
| ---------------------------------------- | --------------------------- | ------------------------------------- |
| `--name <value>`                         | `name`                      | Document title                        |
| `--summary <value>`                      | `summary`                   | Document summary                      |
| `--display-author <value>`               | `displayAuthor`             | Author display name                   |
| `--display-publish-time <value>`         | `displayPublishTime`        | Publish date (YYYY-MM-DD)             |
| `--icon <value>`                         | `icon`                      | Icon (ipfs:// or file://)             |
| `--cover <value>`                        | `cover`                     | Cover image (ipfs:// or file://)      |
| `--site-url <value>`                     | `siteUrl`                   | Site URL                              |
| `--layout <value>`                       | `layout`                    | Layout style                          |
| `--show-outline / --no-show-outline`     | `showOutline`               | Show/hide outline                     |
| `--show-activity / --no-show-activity`   | `showActivity`              | Show/hide activity                    |
| `--content-width <value>`                | `contentWidth`              | Content width (S, M, L)               |
| `--seed-experimental-logo <value>`       | `seedExperimentalLogo`      | Logo (ipfs:// or file://)             |
| `--seed-experimental-home-order <value>` | `seedExperimentalHomeOrder` | Ordering (UpdatedFirst, CreatedFirst) |
| `--import-categories <value>`            | `importCategories`          | Categories (comma-separated)          |
| `--import-tags <value>`                  | `importTags`                | Tags (comma-separated)                |

Fields that accept `file://` paths (`--icon`, `--cover`, `--seed-experimental-logo`) are automatically resolved to
`ipfs://` at publish time.

**What happens internally:**

1. Parses input content (markdown → block tree, JSON → block nodes, PDF → extracted blocks)
2. Merges metadata: defaults < frontmatter/PDF metadata < CLI flags
3. Resolves `file://` links in blocks and metadata to `ipfs://CID` (chunks files with UnixFS)
4. Creates three signed blobs: genesis change, document change, and version ref
5. Publishes all blobs (document + file/image data) atomically to the server

### Update Document Metadata or Content

```bash
# Update title
$SEED_CLI document update <hm-id> --name "New Title" --key mykey

# Update metadata fields
$SEED_CLI document update <hm-id> --summary "New summary" --display-author "New Author" --key mykey

# Update content from file (smart diff — only changed blocks are submitted)
$SEED_CLI document update <hm-id> -f updated-content.md --key mykey

# Delete specific blocks
$SEED_CLI document update <hm-id> --delete-blocks "blockId1,blockId2" --key mykey

# Combine metadata and content update
$SEED_CLI document update <hm-id> -f content.md --name "New Title" --key mykey

# Development mode
$SEED_CLI document update <hm-id> --name "Title" --key mykey --dev
```

**Parameters:**

- `<hm-id>`: Hypermedia ID of the document (e.g., `hm://z6Mk.../path`)
- `-f, --file <path>`: Input file (format detected by extension: .md, .json). Diffs against existing content — only
  changed blocks are submitted.
- `--parent <blockId>`: Parent block ID for new content (default: document root)
- `--delete-blocks <ids>`: Comma-separated block IDs to delete
- All metadata flags from the create command (see table above)
- `-k, --key`: Signing key name or account ID
- `--dev`: Use development environment

When using `-f`, the CLI performs a per-block diff against the existing document:

- Blocks with IDs matching the existing document are compared for content changes — only modified blocks are submitted.
- Blocks with unknown IDs are treated as new.
- Old blocks absent from the input are deleted.
- Metadata from frontmatter is applied as defaults — CLI flags take priority.

### Create a Comment

```bash
# Inline text
$SEED_CLI comment create <target-hm-id> --body "My comment" --key mykey

# From a file
$SEED_CLI comment create <target-hm-id> --file comment.md --key mykey

# Reply to an existing comment
$SEED_CLI comment create <target-hm-id> --body "Reply text" --reply <comment-id> --key mykey

# Development mode
$SEED_CLI comment create <target-hm-id> --body "Comment" --key mykey --dev
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

3. **Ask for the document path** — Before creating a document, always ask the user what path (`-p`) to publish under.
   The path determines the document's permanent URL (e.g., `hm://z6Mk.../the-path`). Never auto-generate or assume a
   path — this decision belongs to the user.

4. **Prepare content** — Write markdown with frontmatter (preferred) or JSON blocks.

5. **Publish** — Use the appropriate write command:

   ```bash
   $SEED_CLI document create -f content.md --key mykey --dev
   ```

6. **Verify** — Read the document again to confirm the change was applied.

### Producing Content for Seed

When generating content for Seed documents, prefer **markdown with frontmatter** over JSON blocks:

- Markdown is easier to read, review, and edit
- Frontmatter handles all metadata fields
- Images with `![alt](path)` are converted to Image blocks automatically
- Local file paths get `file://` prepended and resolved to IPFS at publish time

Use JSON blocks only when you need precise control over block IDs, annotations with exact byte offsets, or non-standard
block types (Embed, WebEmbed, Button, etc.).

### Finding Document IDs

If the user refers to a document by name rather than ID, use the read skill to search:

```bash
# Search for documents
$SEED_CLI search "document name" --server https://hyper.media

# List documents in a space
$SEED_CLI query z6Mk... --mode AllDescendants -q
```

## Error Handling

| Error                   | Cause                           | Fix                                                    |
| ----------------------- | ------------------------------- | ------------------------------------------------------ |
| "No signing keys found" | No keys in keyring              | Run `$SEED_CLI key import` or `$SEED_CLI key generate` |
| "Key not found"         | Specified key doesn't exist     | Check `$SEED_CLI key list` for available keys          |
| "No input provided"     | No `-f` flag and no piped stdin | Provide content via `-f <file>` or pipe to stdin       |
| "No changes found"      | Document doesn't exist          | Verify the HM ID is correct                            |
| "API error (403)"       | Key lacks write permission      | Key must be the document owner or have a capability    |
| "API error (500)"       | Server-side error               | Check server URL, try again                            |

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

- `account-uid`: Public key ID (z6Mk...) — derived from signing key automatically
- `path`: Optional document path (e.g., `/projects/alpha`)
- `version`: Optional version CID

Examples:

```
hm://z6Mkon33EULrw7gnZHrcqX89W11NtEatDk6rnq2Qm7ysJwm4
hm://z6Mkon33EULrw7gnZHrcqX89W11NtEatDk6rnq2Qm7ysJwm4/my-document
```

## Piping and Round-trip

The CLI supports UNIX-style piping. `document get` outputs markdown with frontmatter and block IDs by default, which can
be piped back through `document create` or `document update` to recreate or modify documents.

### Default Output Format

`document get` produces markdown by default (no `--md` flag needed). Use `--json`, `--yaml`, or `--pretty` for
structured output.

```bash
# Default: markdown with frontmatter and block IDs
$SEED_CLI document get hm://z6Mk.../my-doc

# Structured output
$SEED_CLI document get hm://z6Mk.../my-doc --json

# Write to file
$SEED_CLI document get hm://z6Mk.../my-doc -o doc.md
```

### Block ID Preservation

Block IDs are embedded as HTML comments (`<!-- id:XXXXXXXX -->`). When the output is piped back through
`document update -f`, these IDs enable smart per-block diffing. This enables:

- **Round-trip editing**: Export → edit → update with minimal changes
- **Smart diffing**: `document update -f` matches blocks by ID and only submits changes
- **Stable references**: Block-level links (e.g., `hm://z6Mk.../doc?b=XXXXXXXX`) remain valid after re-import

```bash
# Export, edit, re-import (only changed blocks are submitted)
$SEED_CLI document get hm://z6Mk.../my-doc -o doc.md
# ... edit doc.md ...
$SEED_CLI document update hm://z6Mk.../my-doc -f doc.md --key mykey

# Same works with JSON (block IDs are always present in JSON output)
$SEED_CLI document get hm://z6Mk.../my-doc --json -o doc.json
# ... edit doc.json ...
$SEED_CLI document update hm://z6Mk.../my-doc -f doc.json --key mykey

# Plain markdown (no ID comments) → full body replacement
echo "# New Content" | $SEED_CLI document update hm://z6Mk.../my-doc -f - --key mykey
```

### Frontmatter in Output

The markdown output always includes YAML frontmatter with all `HMMetadata` fields that have values. System fields
(`authors`, `version`, `genesis`) are NOT included — only user-settable metadata. The `name:` key is the canonical title
field (the parser also accepts `title:` as a backward-compatible alias).

## Key Rules

1. **Always ask for the document path** — Before creating a document, always ask the user what path (`-p`) to publish
   under. The path determines the document's permanent URL (e.g., `hm://z6Mk.../the-path`). Never auto-generate or
   decide a path unilaterally — this decision belongs to the user.
2. **Always use --dev for testing** — Never write to production without explicit user confirmation.
3. **Check key ownership** — The signing key must be the document owner's key or have a delegated capability.
4. **Read before writing** — Always fetch the document first to understand its current state.
5. **One operation at a time** — Don't batch multiple document updates in a single command.
6. **Verify after writing** — Read the document again to confirm changes applied correctly.
7. **Never expose mnemonics** — Don't log or display mnemonic phrases in output.
8. **Prefer markdown** — Use markdown with frontmatter for content generation; use JSON blocks only when precise block
   control is needed.

## Server Configuration

Default server: `https://hyper.media`

Override per-command:

```bash
$SEED_CLI --server http://localhost:4000 document create -f content.md --key mykey
```

Or set globally:

```bash
$SEED_CLI config --server http://localhost:4000
```

Environment variable:

```bash
SEED_SERVER=http://localhost:4000 $SEED_CLI document create -f content.md --key mykey
```
