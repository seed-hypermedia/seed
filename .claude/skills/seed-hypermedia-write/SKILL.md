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

### 1. Ensure CLI is Available and Up-to-Date

The Seed CLI is distributed as the npm package **`@seed-hypermedia/cli`** (binary: `seed-cli`). Run this detection flow
**once per session** to set `SEED_CLI` for all subsequent commands:

```bash
# 1. Check for existing global install
if command -v seed-cli &>/dev/null; then
  SEED_CLI="seed-cli"

  # Check for updates: compare local vs. npm registry version
  LOCAL_V=$(seed-cli --version 2>/dev/null)
  LATEST_V=$(npm view @seed-hypermedia/cli version 2>/dev/null)
  if [ -n "$LATEST_V" ] && [ "$LOCAL_V" != "$LATEST_V" ]; then
    npm install -g @seed-hypermedia/cli@latest 2>/dev/null && echo "Updated seed-cli $LOCAL_V → $LATEST_V"
  fi

# 2. Not installed — install globally from npm
elif command -v npm &>/dev/null; then
  npm install -g @seed-hypermedia/cli
  SEED_CLI="seed-cli"

# 3. Global install not possible — use npx (downloads on demand)
elif command -v npx &>/dev/null; then
  SEED_CLI="npx -y @seed-hypermedia/cli"

# 4. Last resort — run from repository source (only inside the seed repo)
elif [ -f "frontend/apps/cli/src/index.ts" ]; then
  SEED_CLI="bun run frontend/apps/cli/src/index.ts"
  # If dependencies are missing: cd frontend/apps/cli && bun install

else
  echo "ERROR: Cannot find or install seed-cli. Install Node.js and run: npm install -g @seed-hypermedia/cli"
fi
```

Verify the CLI is working:

```bash
$SEED_CLI --help
```

### 2. Check Available Keys

Keys are stored in the OS keyring, shared with the Seed daemon. The account ID is derived automatically from the signing
key.

**IMPORTANT:** Mainnet and devnet use **separate keyrings**. A key from one network does not exist in the other. Always
list keys with the **same environment flag** you will use for publishing — use `key list --dev` when you intend to
publish with `--dev`, and `key list` (no flag) when targeting mainnet.

```bash
# List keys (mainnet — production)
$SEED_CLI key list

# List keys (devnet — development)
$SEED_CLI key list --dev
```

If no keys exist, the user must import or generate one:

```bash
# Import from mnemonic (recovers existing account)
$SEED_CLI key import -n mykey "word1 word2 ... word12"

# Generate a new key
$SEED_CLI key generate -n mykey --show-mnemonic
```

### 3. Determine Server & Environment

Seed Hypermedia operates on **completely separate, isolated networks**. Each network is effectively a different protocol
— keys, documents, accounts, and all data belong to one network only. Nothing is shared or visible across networks.

| Environment                 | Flag       | Keyring            | Default server          |
| --------------------------- | ---------- | ------------------ | ----------------------- |
| **Mainnet** (production)    | _(none)_   | `seed-daemon-main` | `https://hyper.media`   |
| **Devnet** (development)    | `--dev`    | `seed-daemon-dev`  | _(local or configured)_ |
| **Custom server** (testnet) | `--server` | depends on `--dev` | user-specified URL      |

**What "isolated" means in practice:**

- A key registered on mainnet **does not exist** on devnet. You cannot use it there.
- A document published on devnet **cannot be seen, fetched, or referenced** from mainnet.
- Searching on one network returns **zero results** from the other.
- `hm://` IDs are network-scoped — the same account ID on mainnet and devnet are unrelated identities.

**IMPORTANT:** The `--dev` flag (or lack of it) must be used **consistently on every command** in a session — including
`key list`, `search`, `document get`, `document create`, etc. Mixing flags (e.g., listing keys without `--dev` but
publishing with `--dev`) will cause "Key not found" errors because you are crossing network boundaries.

Always ask the user which environment to target if unclear. Use `--dev` when testing. Determine the server context early
and keep it consistent across the entire session.

```bash
# Mainnet (default — no flags needed)
$SEED_CLI key list
$SEED_CLI search "topic" --type hybrid --limit 40
$SEED_CLI document create -f content.md --key mykey

# Devnet — --dev on EVERY command
$SEED_CLI key list --dev
$SEED_CLI search "topic" --type hybrid --limit 40 --dev
$SEED_CLI document create -f content.md --key mykey --dev

# Custom server — --server on EVERY command (combine with --dev if targeting a dev server)
$SEED_CLI search "topic" --type hybrid --limit 40 --server http://localhost:4000
$SEED_CLI document create -f content.md --key mykey --server http://localhost:4000
```

## CLI Alias

All examples below use `$SEED_CLI`, which was set during the prerequisite detection step above. If you skipped
prerequisites, run the detection flow from
[Ensure CLI is Available and Up-to-Date](#1-ensure-cli-is-available-and-up-to-date) first.

## Draft Management

The CLI has a `draft` subcommand for managing local document drafts before publishing. Drafts are stored in the
platform-specific Seed app data directory (shared with the desktop app):

- Linux: `~/.config/Seed/drafts/`
- macOS: `~/Library/Application Support/Seed/drafts/`
- Windows: `%APPDATA%\Seed\drafts\`

With `--dev`, "Seed" becomes "Seed-local". Override with `SEED_CLI_DRAFTS_DIR` env var.

The slug is auto-generated from the document title (lowercase, hyphens, max 60 chars). The CLI can also read `.json`
drafts created by the desktop app.

### Draft Commands

```bash
# Save a draft (validates content, saves to <drafts-dir>/<slug>.md)
$SEED_CLI draft create -f content.md

# Save to a custom path
$SEED_CLI draft create -f content.md -o /path/to/custom-name.md

# Review a draft (raw markdown) — works with both .md and .json drafts
$SEED_CLI draft get <slug>

# Review with terminal-rendered pretty output
$SEED_CLI draft get <slug> --pretty

# List all drafts (both .md and .json)
$SEED_CLI draft list

# Remove a specific draft
$SEED_CLI draft rm <slug> --force

# Remove all .md drafts
$SEED_CLI draft rm --all --force
```

**Collision handling:** If a draft with the same slug already exists, `draft create` will error. Use `-o` to explicitly
overwrite, or `draft rm` to remove the old draft first.

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

### Draft Mode (Default)

When the user asks to "draft", "write", "create a document", or any request that does not explicitly say "publish", use
the draft-first workflow. **Never publish directly unless the user explicitly asks.**

1. **Read first** — If updating an existing document, use the **seed-hypermedia-read** skill to fetch it.

2. **Identify the key** — List available keys **from the target environment** and confirm which one to use. The
   environment flag on `key list` MUST match the flag you will use for publishing — networks are isolated and keys do
   not cross over.

   ```bash
   # If targeting devnet:
   $SEED_CLI key list --dev

   # If targeting mainnet:
   $SEED_CLI key list
   ```

   **Hint for batched prompts:** If you need to ask the user about the environment _and_ the signing key in the same
   interaction round (e.g., when using a question tool that batches multiple questions), run **both** `key list` and
   `key list --dev` upfront. Then present all discovered keys grouped and labeled by network (e.g., "mykey (mainnet)",
   "devkey (devnet)") so the user can pick any key regardless of which environment they choose. Additionally, include a
   free-text option for the user to paste a raw key:

   - **Public key** (starts with `z6Mk`): look it up in the matching keyring.
   - **Private key or mnemonic**: derive the account ID using `$SEED_CLI key derive`.

3. **Ask for the document path** — Before creating a document, always ask the user what path (`-p`) to publish under.
   The path determines the document's permanent URL (e.g., `hm://z6Mk.../the-path`). Never auto-generate or assume a
   path — this decision belongs to the user.

4. **Determine server context** — Mainnet (`https://hyper.media`) by default. If the user mentioned a custom server,
   testnet, or devnet, capture the URL and use `--server <url>` on all subsequent commands.

5. **Research** — Search for related content (see [Research & Citation](#research--citation) below). Use `--server` if
   targeting a non-default server. This step is always performed, even when the user provides full content.

6. **Prepare content** — Write markdown with frontmatter (preferred) or JSON blocks. Incorporate relevant citations from
   the research step as inline hypermedia links.

7. **Save draft** — Write the markdown to a temporary file, then save it as a draft:

   ```bash
   $SEED_CLI draft create -f <temp-file>
   ```

   The CLI validates the content (parses markdown, checks structure) and saves to the platform-specific drafts
   directory. The output includes the full path where the draft was saved.

8. **Validate** — Run a dry-run using the draft slug to check the content renders correctly:

   ```bash
   $SEED_CLI draft get <slug> --pretty
   ```

   Check stdout/stderr for any errors. If there are problems, fix the content, re-save the draft, and re-check.

9. **Present follow-up actions** — Always end by telling the user what commands to run next. Use the draft slug (printed
   in the `draft create` output) for all references:

   ```
   Draft saved as "<slug>"

   Review:    $SEED_CLI draft get <slug> --pretty
   Publish:   $SEED_CLI document create -f <path-from-output> --key <key> -p <path> [--server <url>]
   Clean up:  $SEED_CLI draft rm <slug>
   ```

   For document updates, replace the publish command with:

   ```
   Publish:   $SEED_CLI document update <hm-id> -f <path-from-output> --key <key> [--server <url>]
   ```

### Publish Mode

When the user explicitly says "publish", "publish it", "push it live", or similar:

- If a draft already exists for the document, publish from the draft (use the path from `draft create` output):
  ```bash
  $SEED_CLI document create -f <path-from-draft-create-output> --key <key> -p <path> [--dev] [--server <url>]
  ```
- If no draft exists, generate content and publish directly (steps 1–6 from Draft Mode, then publish).
- **Verify** — Read the document again to confirm the change was applied.

### Producing Content for Seed

When generating content for Seed documents, prefer **markdown with frontmatter** over JSON blocks:

- Markdown is easier to read, review, and edit
- Frontmatter handles all metadata fields
- Images with `![alt](path)` are converted to Image blocks automatically
- Local file paths get `file://` prepended and resolved to IPFS at publish time

Use JSON blocks only when you need precise control over block IDs, annotations with exact byte offsets, or non-standard
block types (Embed, WebEmbed, Button, etc.).

### Research & Citation

Every write operation includes a research phase. Before generating content, search for related documents and comments on
the server. If the results are relevant, incorporate them as inline citations. If the search fails or returns nothing
useful, proceed without citations — never block on this step.

#### Step 1: Search

Run a hybrid search with large context and a high result limit to cast a wide net. Include `--server <url>` when
targeting a non-default server:

```bash
# Mainnet (default)
$SEED_CLI search "topic or key phrase" --type hybrid --context-size 300 --limit 40

# Custom server
$SEED_CLI search "topic or key phrase" --type hybrid --context-size 300 --limit 40 --server <url>
```

The `--type hybrid` flag combines keyword and semantic (embedding-based) search with reciprocal rank fusion, returning
the most relevant results across both methods. The `--context-size 300` flag returns ~300 characters of surrounding
context per match, giving you enough text to judge relevance without fetching full documents. The `--limit 40` flag
requests up to 40 results. By default, search includes document body content and comments (not just titles), which
provides block-level matches with `blockRef` IDs suitable for precise citations. Use `--titles-only` to restrict to
title matches only.

If the document topic is broad, run multiple searches with different queries to cover subtopics.

In quiet mode (`-q`), the output is tab-separated: `id\tblockRef\ttype\ttitle`. The `id` is a full `hm://` URL, the
`blockRef` is the specific block that matched (may be empty for title matches), `type` is `document` or `contact`, and
`title` is the content snippet.

#### Step 2: Triage

From the 30–50 results (a mix of document body matches, title matches, and comments), identify 5–10 candidate documents
that are most relevant to the content being written. Consider:

- **Topical overlap** — Does the result discuss the same subject?
- **Complementary information** — Does it provide context, evidence, or a different perspective?
- **Comments** — Comments are valid citation targets too. A comment may contain a key insight worth referencing.

Discard results that are only superficially related (e.g., same keywords but different domain).

#### Step 3: Fetch Candidates

For each candidate, fetch the full document to validate relevance:

```bash
# Fetch a document
$SEED_CLI document get hm://z6Mk.../path

# Fetch a comment
$SEED_CLI comment get <comment-id>
```

Read the full content and confirm that the connection to the document being written is strong enough to cite.

#### Step 4: Write with Citations

When generating content, embed citations as inline markdown links using `hm://` URLs. Block-level references point
readers directly to the specific paragraph being cited:

```markdown
According to a recent analysis, the performance improvements were significant
([Performance Report](hm://z6Mk.../performance-report#blockId)).
```

Citation link format:

| Target          | Format                                               |
| --------------- | ---------------------------------------------------- |
| Document        | `[Title](hm://z6Mk.../path)`                         |
| Specific block  | `[Title](hm://z6Mk.../path#blockId)`                 |
| Versioned block | `[Title](hm://z6Mk.../path?v=version#blockId)`       |
| Comment         | `[Comment by Author](hm://z6Mk.../path?c=commentId)` |

Use the `blockRef` from search results to construct block-level links. If a search result has no `blockRef`, link to the
document as a whole.

**Guidelines:**

- Only cite when the reference genuinely enriches the content — don't force citations.
- Prefer block-level links over whole-document links when the search result identifies a specific block.
- Use descriptive link text (document title, section heading, or a brief description) — not raw IDs.
- If multiple search results point to the same document, cite the most specific block.
- When citing a comment, include the author name or a brief description in the link text.

#### Graceful Degradation

If any step fails (network error, server unreachable, no relevant results), skip citations and write the content without
them. Never let the research phase block the write operation. Log a brief note to the user that search was unavailable
so they know citations were skipped.

### Finding Document IDs

If the user refers to a document by name rather than ID, search for it:

```bash
# Search for documents by name
$SEED_CLI search "document name"

# Semantic search (finds conceptually similar documents even with different wording)
$SEED_CLI search "document name" --type semantic

# List all documents in a space
$SEED_CLI query z6Mk... --mode AllDescendants -q
```

## Error Handling

| Error                   | Cause                                                                                                                                                                                           | Fix                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "No signing keys found" | No keys in keyring for the target environment                                                                                                                                                   | Run `$SEED_CLI key import` or `$SEED_CLI key generate` (with `--dev` if targeting devnet)                 |
| "Key not found"         | Key doesn't exist in the target environment's keyring. Most common cause: listing keys from mainnet but publishing with `--dev`, or vice versa. Networks are isolated — keys do not cross over. | Run `key list` with the **same** environment flag (`--dev` or none) you are using for the failing command |
| "No input provided"     | No `-f` flag and no piped stdin                                                                                                                                                                 | Provide content via `-f <file>` or pipe to stdin                                                          |
| "No changes found"      | Document doesn't exist on the target network                                                                                                                                                    | Verify the HM ID is correct and that you are targeting the right network (`--dev` or mainnet)             |
| "API error (403)"       | Key lacks write permission                                                                                                                                                                      | Key must be the document owner or have a capability                                                       |
| "API error (500)"       | Server-side error                                                                                                                                                                               | Check server URL, try again                                                                               |

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

1. **Draft by default** — Never publish directly unless the user explicitly requests it. Always save content to a draft
   first via `draft create`, validate with a dry-run, and present follow-up commands (review, publish, edit, clean up).
2. **Consistent environment on every command** — Mainnet and devnet are isolated networks (effectively different
   protocols). The `--dev` flag, `--server <url>`, or neither must be used **identically on every command** in a
   session: `key list`, `search`, `document get`, `document create`, `document update`, dry-runs, and fetching. Mixing
   flags across commands (e.g., `key list` without `--dev` then `document create --dev`) crosses network boundaries and
   will fail.
3. **Always ask for the document path** — Before creating a document, always ask the user what path (`-p`) to publish
   under. The path determines the document's permanent URL (e.g., `hm://z6Mk.../the-path`). Never auto-generate or
   decide a path unilaterally — this decision belongs to the user.
4. **Always use --dev for testing** — Never write to production without explicit user confirmation. Mainnet and devnet
   are completely isolated networks — keys, documents, and accounts do not cross over between them. A key that exists on
   mainnet will produce a "Key not found" error when used with `--dev`, and vice versa.
5. **Check key ownership** — The signing key must be the document owner's key or have a delegated capability.
6. **Read before writing** — Always fetch the document first to understand its current state.
7. **One operation at a time** — Don't batch multiple document updates in a single command.
8. **Verify after publishing** — Read the document again to confirm changes applied correctly.
9. **Never expose mnemonics** — Don't log or display mnemonic phrases in output.
10. **Prefer markdown** — Use markdown with frontmatter for content generation; use JSON blocks only when precise block
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
