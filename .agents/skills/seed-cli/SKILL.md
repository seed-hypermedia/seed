---
name: seed-cli
description:
  Recommended starting point — no local setup needed. Create, update, and read Seed Hypermedia documents and comments
  using the Seed CLI. Use when the user wants to write, read, search, or manage Seed documents. Connects to remote
  servers (hyper.media by default).
---

# Seed CLI Skill

Scope: Document operations on Seed Hypermedia via the Seed CLI — creating, updating, reading documents and comments,
searching, and managing drafts. For low-level gRPC access to a local Seed daemon, use the **seed-grpc** skill. For
LLM-powered PDF import see the **seed-pdf-import** skill.

## Prerequisites

### 1. Ensure CLI is Available and Up-to-Date

The Seed CLI is distributed as the npm package **`@seed-hypermedia/cli`** (binary: `seed-cli`).

**Use `npx` to run it** — this avoids global install permission issues and always fetches the latest version:

```bash
npx -y @seed-hypermedia/cli@latest --help
```

Throughout this skill, replace any `seed-cli <command>` with `npx -y @seed-hypermedia/cli@latest <command>`. The `-y`
flag auto-confirms the install prompt. `npx` caches the package locally after first run, so subsequent calls are fast.

If the user already has `seed-cli` installed globally (check with `command -v seed-cli`), you may use `seed-cli`
directly instead of the `npx` form.

### 2. Check Available Keys

The CLI resolves signing keys from **two sources** (vault support requires `@seed-hypermedia/cli` >= 0.2.0 — the
`npx ...@latest` form always qualifies):

1. **The vault** (`vault.json`) — the encrypted identity store used by the daemon and desktop app. Identities created in
   the desktop app (the user's real accounts) are available for signing. Read-only: the CLI never modifies the vault.
   Discovery order: `--vault <path>` flag → `SEED_VAULT_PATH` env var → `vaultPath` in `~/.seed/config.json`
   (`seed-cli config --vault-path <path>`) → well-known locations (Linux desktop app:
   `~/.config/Seed/daemon/vault.json`, `Seed-dev` with `--dev`; macOS:
   `~/Library/Application Support/Seed/daemon/vault.json`; bare daemon: `~/.mtt/vault.json`). The vault's decryption
   secret (KEK) comes from the OS keychain (service `seed-hypermedia-vault-secret-v2`); on headless machines pass
   `SEED_VAULT_KEK` (base64, 32 bytes) directly — treat it like a private key.
2. **The OS keyring** — legacy store, still used for keys the CLI creates itself (`key generate` / `key import`).
   Service `seed-daemon-main` (mainnet) or `seed-daemon-dev` (devnet).

When a name/account exists in both, the vault wins. `key list` shows a `source` field (`vault` or `keyring`) per key. No
daemon needs to be running. **Mainnet identities typically live in the desktop app's vault**, not the keyring — an empty
or missing `seed-daemon-main` keyring does NOT mean there are no mainnet keys; always check `key list` (vault included).
If `key list` output has no `source` field, the installed CLI predates vault support — use the `npx ...@latest` form
instead. Full reference: `docs/KEYS.md` shipped with the npm package
(https://unpkg.com/@seed-hypermedia/cli/docs/KEYS.md).

**IMPORTANT:** Mainnet and devnet use **separate keyrings and separate vaults**. A key from one network does not exist
in the other. Always list keys with the **same environment flag** you will use for publishing — use `key list --dev`
when you intend to publish with `--dev`, and `key list` (no flag) when targeting mainnet.

```bash
# List keys (mainnet — production; vault + keyring, with source field)
seed-cli key list

# List keys (devnet — development)
seed-cli key list --dev

# Read a specific vault file explicitly
seed-cli --vault /path/to/vault.json key list
```

If no keys exist, the user must import or generate one:

```bash
# Import from mnemonic (recovers existing account)
seed-cli key import -n mykey "word1 word2 ... word12"

# Generate a new key
seed-cli key generate -n mykey --show-mnemonic
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
seed-cli key list
seed-cli search "topic" --type hybrid --limit 40
seed-cli document create -f content.md --key mykey

# Devnet — --dev on EVERY command
seed-cli key list --dev
seed-cli search "topic" --type hybrid --limit 40 --dev
seed-cli document create -f content.md --key mykey --dev

# Custom server — --server on EVERY command (combine with --dev if targeting a dev server)
seed-cli search "topic" --type hybrid --limit 40 --server http://localhost:4000
seed-cli document create -f content.md --key mykey --server http://localhost:4000
```

## Draft Management

The CLI has a `draft` subcommand for managing local document drafts before publishing. Drafts are stored as markdown
files in the platform-specific Seed app data directory (shared with the desktop app):

- Linux: `~/.config/Seed/drafts/`
- macOS: `~/Library/Application Support/Seed/drafts/`
- Windows: `%APPDATA%\Seed\drafts\`

With `--dev`, "Seed" becomes "Seed-local". Override with `SEED_CLI_DRAFTS_DIR` env var.

Draft filenames follow the format `<slug>_<nanoid>.md` (e.g., `my-document_aBcDeFgHiJ.md`). The slug is auto-generated
from the document title (lowercase, hyphens, max 60 chars) and the nanoid is a unique 10-character ID. The CLI can also
read `.json` drafts created by older versions of the desktop app.

Drafts are also registered in `index.json` which stores routing metadata (publish target, visibility, dependencies) that
cannot be expressed in markdown frontmatter. The desktop app reads both the `.md` files and `index.json` to display
drafts — CLI-created drafts appear in the desktop app without restarting it.

### Draft Commands

```bash
# Save a draft (validates content, saves to <drafts-dir>/<slug>_<nanoid>.md)
seed-cli draft create -f content.md

# Save a draft with a publish target (edits an existing document)
seed-cli draft create -f content.md --edit hm://z6Mk.../docs/intro

# Save a draft as a new child document under a parent
seed-cli draft create -f content.md --location hm://z6Mk.../docs

# Save a draft with explicit visibility
seed-cli draft create -f content.md --visibility PRIVATE

# Save to a custom path (bypasses drafts directory and index.json)
seed-cli draft create -f content.md -o /path/to/custom-name.md

# Review a draft (raw markdown) — works with both .md and .json drafts
seed-cli draft get <slug-or-id>

# Review with terminal-rendered pretty output
seed-cli draft get <slug-or-id> --pretty

# List all drafts (both .md and .json)
seed-cli draft list

# Remove a specific draft
seed-cli draft rm <slug-or-id> --force

# Remove all .md drafts
seed-cli draft rm --all --force
```

**Routing flags for `draft create`:**

| Flag                   | Description                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `--edit <hm-url>`      | HM URL of the document to edit (sets `editUid`/`editPath` in index)              |
| `--location <hm-url>`  | HM URL of the parent to create a child under (sets `locationUid`/`locationPath`) |
| `--visibility <value>` | Document visibility: `PUBLIC` or `PRIVATE` (default: `PUBLIC`)                   |

When `--edit` or `--location` is provided, the CLI writes the routing metadata to `index.json` so the desktop app knows
the draft's publish target. Without these flags, the draft appears in the desktop as a "no target" draft and the user is
prompted to choose a publish location.

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
[./references/seed-document-format.md](./references/seed-document-format.md) for the complete block format reference.

```bash
seed-cli document create -f blocks.json --name "Title" --key mykey
```

## Resolving Web URLs

Any CLI command that takes an `hm://` ID also accepts a plain `https://` URL (e.g., `seed-cli document get`,
`document update`, `comment list`, `comment create`, `query`). Prefer the URL form when the user pastes one — there is
no need to resolve the domain to an account UID first.

- The server is inferred from the URL origin; `--server` is **not required** when passing a URL.
- Fragments are preserved through URL resolution: `#<blockId>` and `#<blockId>[start:end]` (character ranges).
- **Anti-pattern:** do **not** wrap a domain in `hm://` (e.g., `hm://seedteamtalks.hyper.media`). `hm://` authorities
  are account UIDs, not hostnames. Site domains are strictly for HTTP routing — pass the full `https://` URL instead.

```bash
# ✓ Works — auto-detects server from URL origin, no --server needed
seed-cli document get "https://seedteamtalks.hyper.media/discussions/how-to-bring-legalize-es-to-seed"
seed-cli comment list "https://seedteamtalks.hyper.media/discussions/how-to-bring-legalize-es-to-seed"
seed-cli document get "https://hyper.media"  # bare domain → root doc

# ✓ Works — URL with block fragment
seed-cli document get "https://seedteamtalks.hyper.media/discussions/how-to-bring-legalize-es-to-seed#vHwg_kR0"

# ✗ Fails — do NOT construct hm:// from a domain name
seed-cli document get "hm://seedteamtalks.hyper.media" --server "https://seedteamtalks.hyper.media"
# → invalid_argument: failed to parse account 'seedteamtalks.hyper.media': selected encoding not supported
```

### Fallback: HTTP Identity Headers

When the CLI is not available (shell scripts, bespoke tooling), every Seed site page exposes identity headers on
GET/HEAD/OPTIONS. They are CORS-exposed and URL-encoded.

- `X-Hypermedia-Id` — canonical `hm://<account>/<path>` (URL-encoded)
- `X-Hypermedia-Version` — current version CID
- `X-Hypermedia-Type` — `Document` or `Comment`
- `X-Hypermedia-Title`, `X-Hypermedia-Authors`
- `X-Hypermedia-Target` — (comment pages only) `hm://` of the target document being commented on

Values are URL-encoded; decode before use. Example:

```bash
curl -sI "https://site.hyper.media/my-doc" | awk '/x-hypermedia-id/ {print}' | python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read().split(": ", 1)[1]))'
```

## Write Operations

### Create a New Document

The account ID is derived automatically from the signing key — no positional argument needed.

**Space publishing:** By default, the document is published under the signing key's own account. To publish under a
shared space/site account (e.g. a team site where you have WRITER capability), use the `--account` flag. The CLI
automatically resolves the required capability from the target account.

```bash
# From a markdown file
seed-cli document create -f content.md --key mykey

# Publish under a shared space/site account (requires WRITER or AGENT capability)
seed-cli document create -f content.md --key mykey --account z6MkSpaceAccountId

# From markdown with explicit metadata flags (override frontmatter)
seed-cli document create -f content.md --name "My Document" --summary "Description" --key mykey

# From JSON blocks
seed-cli document create -f blocks.json --name "Title" --key mykey

# From stdin (piped markdown)
echo "# Hello World" | seed-cli document create --name "Hello" --key mykey

# PDF import (built-in extraction)
seed-cli document create -f paper.pdf --key mykey

# With GROBID for better PDF extraction
seed-cli document create -f paper.pdf --grobid-url http://localhost:8070 --key mykey

# Preview PDF extraction without publishing
seed-cli document create -f paper.pdf --dry-run

# Custom path and development mode
seed-cli document create -f content.md -p my-document --key mykey --dev
```

**Parameters:**

- `-f, --file <path>`: Input file (format detected by extension: `.md`, `.json`, `.pdf`)
- `-p, --path <path>`: Document path (e.g. "my-document"). Auto-generated from name if omitted.
- `-k, --key <name>`: Signing key name or account ID
- `-a, --account <uid>`: Target space/account UID — publish under a different account using a delegated capability. The
  CLI automatically resolves a WRITER or AGENT capability for the signing key on the target account.
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
seed-cli document update <hm-id> --name "New Title" --key mykey

# Update metadata fields
seed-cli document update <hm-id> --summary "New summary" --display-author "New Author" --key mykey

# Update content from file (smart diff — only changed blocks are submitted)
seed-cli document update <hm-id> -f updated-content.md --key mykey

# Delete specific blocks
seed-cli document update <hm-id> --delete-blocks "blockId1,blockId2" --key mykey

# Combine metadata and content update
seed-cli document update <hm-id> -f content.md --name "New Title" --key mykey

# Development mode
seed-cli document update <hm-id> --name "Title" --key mykey --dev
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

`<target>` accepts either an `hm://` ID or a plain `https://` URL (see [Resolving Web URLs](#resolving-web-urls)). A
`#<blockId>` fragment on the target triggers block-level quoting (see subsection b below). Block-level quoting and
`--reply` threading are independent axes — they compose.

#### (a) Plain comment

```bash
# Inline text
seed-cli comment create <target> --body "My comment" --key mykey

# From a file
seed-cli comment create <target> --file comment.md --key mykey

# Development mode
seed-cli comment create <target> --body "Comment" --key mykey --dev
```

#### (b) Block-level quoted reply

To produce the "quote + reply" format used in Seed discussions, pass the target with a `#<blockId>` fragment. The CLI
automatically wraps the comment body in an `Embed` block pointing at the quoted block. For precise character-range
quotes, use `#<blockId>[start:end]`.

```bash
# Quote a whole block
seed-cli comment create "hm://<account>/<path>#<blockId>" --body "My reply" --key mykey

# Quote a character range within the block
seed-cli comment create "hm://<account>/<path>#<blockId>[start:end]" --body "My reply" --key mykey

# Same, using a web URL (server inferred from origin — no --server needed)
seed-cli comment create "https://<site>/<path>#<blockId>" --body "My reply" --key mykey
```

Use the `blockRef` field from `search --type hybrid` results to identify blocks to quote. Character ranges come from
`HMBlockRange` objects emitted during rich-text selection; in markdown workflows, prefer whole-block quoting
(`#<blockId>` without a range).

#### (c) Threaded reply (`--reply`)

```bash
# Reply to an existing comment (threading)
seed-cli comment create <target> --body "Reply text" --reply <comment-id> --key mykey
```

`--reply <commentId>` threads the new comment under another comment (reply parent). For the comment-ID shape expected
here (and by `comment get`), see [Finding Document and Comment IDs](#finding-document-and-comment-ids).

#### (d) Combined — threaded reply that also quotes a block

```bash
seed-cli comment create "https://<site>/<path>#<blockId>" --reply <parentCommentId> --body "..." --key mykey
```

**Parameters:**

- `<target>`: `hm://` ID **or** `https://` URL of the document to comment on. A `#<blockId>` or `#<blockId>[start:end]`
  fragment auto-wraps the body in an `Embed` block (block-level quoted reply).
- `--body`: Comment text (inline)
- `--file`: Read comment text from a file
- `--reply`: Reply to an existing comment by its ID — independent of block-level quoting; combine freely
- `-k, --key`: Signing key name or account ID
- `--dev`: Use development environment

## Workflow

### Draft Mode (Default)

When the user asks to "draft", "write", "create a document", or any request that does not explicitly say "publish", use
the draft-first workflow. **Never publish directly unless the user explicitly asks.**

1. **Read first** — If updating an existing document, use the **seed-grpc** skill to fetch it.

2. **Identify the key** — List available keys **from the target environment** and confirm which one to use. The
   environment flag on `key list` MUST match the flag you will use for publishing — networks are isolated and keys do
   not cross over.

   ```bash
   # If targeting devnet:
   seed-cli key list --dev

   # If targeting mainnet:
   seed-cli key list
   ```

   **Hint for batched prompts:** If you need to ask the user about the environment _and_ the signing key in the same
   interaction round (e.g., when using a question tool that batches multiple questions), run **both** `key list` and
   `key list --dev` upfront. Then present all discovered keys grouped and labeled by network (e.g., "mykey (mainnet)",
   "devkey (devnet)") so the user can pick any key regardless of which environment they choose. Additionally, include a
   free-text option for the user to paste a raw key:

   - **Public key** (starts with `z6Mk`): look it up in the matching keyring.
   - **Private key or mnemonic**: derive the account ID using `seed-cli key derive`.

   **Resolving unnamed keys:** Some keys have no human-friendly name — their `name` field equals their `accountId` (both
   start with `z6Mk`). For these, resolve the author's display name from their profile:

   ```bash
   # For mainnet keys:
   seed-cli account get <accountId>
   # For devnet keys:
   seed-cli account get <accountId> --dev
   # For a custom domain (e.g., gabo.es):
   seed-cli account get <accountId> --server https://gabo.es
   ```

   The response includes `metadata.name` — use this as the display name when presenting keys to the user. For example,
   show `"Gabo" (z6Mko7..., mainnet)` instead of the raw `z6Mko7VaJL2s1DLR5coY86Px7baLvwaW1eM3NaXjtzAENG2c`. If the
   profile fetch fails (account not registered on that server), fall back to showing the raw accountId.

   The server to query depends on context:

   - **Mainnet keys**: `https://hyper.media` (default, no `--server` needed)
   - **Devnet keys**: `https://dev.hyper.media` (use `--dev` flag)
   - **Custom domain**: if the user specified a domain like `gabo.es`, use `--server https://gabo.es`

3. **Check if the target is a shared space** — If the user wants to publish under a different account (e.g. a team
   site), use the `--account <uid>` flag. The CLI will automatically resolve a WRITER or AGENT capability for the
   signing key on the target account. If no matching capability is found, the command fails with a clear error. To check
   available capabilities beforehand: `seed-cli account capabilities hm://<space-account>`.

4. **Ask for the document path** — Before creating a document, always ask the user what path (`-p`) to publish under.
   The path determines the document's permanent URL (e.g., `hm://z6Mk.../the-path`). Never auto-generate or assume a
   path — this decision belongs to the user.

   **IMPORTANT — Web URLs ≠ document paths:** When the user provides a web URL (e.g.,
   `mysite.hyper.media/discussions/my-doc`), do **not** blindly use the URL path segments as the document path. A site's
   URL path belongs to a **specific space/account** identified by the domain, and display names in the UI (breadcrumbs,
   navigation) can differ from actual paths (e.g., a document titled "Notes" may live at path `/discussions`). You must:

   a. **Resolve the space account** — Determine which account owns the site the user referenced:

   ```bash
   seed-cli document get "hm://<domain>" --server "https://<domain>"
   ```

   The account ID in the returned `hm://` URL is the space owner. Compare it against the user's signing key — if they
   differ, use `--account <space-account-uid>` to publish under the space account. The CLI will automatically resolve a
   WRITER/AGENT capability. If no capability exists, inform the user and ask them to get access from the space owner.

   b. **Verify the actual path** — Do not trust display names. Fetch the document to confirm the path exists:

   ```bash
   seed-cli document get "hm://<account>/<suspected-path>" --server "https://<domain>"
   ```

   If it fails, search by title to discover the real path before proceeding.

5. **Determine server context** — Mainnet (`https://hyper.media`) by default. If the user mentioned a custom server,
   testnet, or devnet, capture the URL and use `--server <url>` on all subsequent commands.

6. **Validate parent paths** — Before creating a document at a nested path (e.g., `docs/guides/intro`), verify that
   every ancestor path exists under the **target account**. Check each level:

   ```bash
   # For path "docs/guides/intro", check:
   seed-cli document get "hm://<account>/docs" --server <url>
   seed-cli document get "hm://<account>/docs/guides" --server <url>
   ```

   If any ancestor is missing, **stop and warn the user** before proceeding. Offer these options:

   - Create the missing parent document(s) first (with a minimal title matching the path segment)
   - Choose a different, existing path
   - Proceed anyway (document will appear orphaned — its parent will show as "red"/missing in the UI)

7. **Research** — Search for related content (see [Research & Citation](#research--citation) below). Use `--server` if
   targeting a non-default server. This step is always performed, even when the user provides full content.

8. **Prepare content** — Write markdown with frontmatter (preferred) or JSON blocks. Incorporate relevant citations from
   the research step as inline hypermedia links.

9. **Save draft** — Write the markdown to a temporary file, then save it as a draft:

   ```bash
   seed-cli draft create -f <temp-file>
   ```

   The CLI validates the content (parses markdown, checks structure) and saves to the platform-specific drafts
   directory. The output includes the full path where the draft was saved.

10. **Validate** — Run a dry-run using the draft slug to check the content renders correctly:

```bash
seed-cli draft get <slug> --pretty
```

Check stdout/stderr for any errors. If there are problems, fix the content, re-save the draft, and re-check.

11. **Present follow-up actions** — Always end by telling the user what commands to run next. Use the draft slug
    (printed in the `draft create` output) for all references:

```
Draft saved as "<slug>"

Review:    seed-cli draft get <slug> --pretty
Publish:   seed-cli document create -f <path-from-output> --key <key> -p <path> [--account <uid>] [--server <url>]
Clean up:  seed-cli draft rm <slug>
```

For document updates, replace the publish command with:

```
Publish:   seed-cli document update <hm-id> -f <path-from-output> --key <key> [--server <url>]
```

### Publish Mode

When the user explicitly says "publish", "publish it", "push it live", or similar:

- If a draft already exists for the document, publish from the draft (use the path from `draft create` output):
  ```bash
  seed-cli document create -f <path-from-draft-create-output> --key <key> -p <path> [--account <uid>] [--dev] [--server <url>]
  ```
- If no draft exists, generate content and publish directly (steps 1–8 from Draft Mode, then publish).
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
seed-cli search "topic or key phrase" --type hybrid --context-size 300 --limit 40

# Custom server
seed-cli search "topic or key phrase" --type hybrid --context-size 300 --limit 40 --server <url>
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
seed-cli document get hm://z6Mk.../path

# Fetch a comment
seed-cli comment get <comment-id>
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

### Finding Document and Comment IDs

If the user provides a web URL, pass it directly to the command — the CLI resolves it and infers the server from the URL
origin (see [Resolving Web URLs](#resolving-web-urls)). Search only when the user refers to a document by name.

```bash
# Search for documents by name
seed-cli search "document name"

# Semantic search (finds conceptually similar documents even with different wording)
seed-cli search "document name" --type semantic

# List all documents in a space
seed-cli query z6Mk... --mode AllDescendants -q
```

#### Comment IDs for `comment get`

Comment IDs passed to `seed-cli comment get` must be in the form `<authorAccount>/<commentShortId>` — **both parts,
slash-separated**. The bare short ID fails (HTTP 500), and so do `hm://` prefixes and full web URLs.

- From `comment list --json`: use the `id` field directly (already in the correct form).
- From a comment web URL like `https://<site>/<path>/:comments/<authorAccount>/<shortId>?v=...`: extract the two
  segments after `:comments/`.
- With a non-default server, always pass `--server <url>` (the raw ID has no origin to infer from).

```bash
# ✓ Right — <authorAccount>/<shortId>
seed-cli comment get "z6Mkq9.../z6GRZhFTZoYFG8" --server "https://seedteamtalks.hyper.media"

# ✗ All of these return HTTP 500
seed-cli comment get "z6GRZhFTZoYFG8" --server "https://seedteamtalks.hyper.media"
seed-cli comment get "hm://z6Mkq9.../z6GRZhFTZoYFG8" --server "https://seedteamtalks.hyper.media"
seed-cli comment get "https://seedteamtalks.hyper.media/discussions/my-doc/:comments/z6Mkq9.../z6GRZhFTZoYFG8" --server "https://seedteamtalks.hyper.media"
```

## Error Handling

| Error                                          | Cause                                                                                                                                                                                           | Fix                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| "No signing keys found"                        | No keys in keyring for the target environment                                                                                                                                                   | Run `seed-cli key import` or `seed-cli key generate` (with `--dev` if targeting devnet)                              |
| "Key not found"                                | Key doesn't exist in the target environment's keyring. Most common cause: listing keys from mainnet but publishing with `--dev`, or vice versa. Networks are isolated — keys do not cross over. | Run `key list` with the **same** environment flag (`--dev` or none) you are using for the failing command            |
| "No input provided"                            | No `-f` flag and no piped stdin                                                                                                                                                                 | Provide content via `-f <file>` or pipe to stdin                                                                     |
| "No changes found"                             | Document doesn't exist on the target network                                                                                                                                                    | Verify the HM ID is correct and that you are targeting the right network (`--dev` or mainnet)                        |
| "API error (403)"                              | Key lacks write permission                                                                                                                                                                      | Key must be the document owner or have a capability                                                                  |
| "API error (500)"                              | Server-side error                                                                                                                                                                               | Check server URL, try again                                                                                          |
| "Document at wrong URL"                        | Used `document create` without `--account`, so the document was published under the signing key's own account instead of the intended space account                                             | Delete the orphan with `document delete`, then re-publish with `--account <space-uid>` to target the correct account |
| "No WRITER or AGENT capability found"          | The signing key has no delegated capability on the target account specified via `--account`                                                                                                     | Ask the space owner to grant a WRITER or AGENT capability to your key, or verify the account UID is correct          |
| `HTTP 500 from Comment: Internal Server Error` | `comment get` was passed a bare short ID, `hm://` form, or full web URL                                                                                                                         | Use `<authorAccount>/<shortId>` form; extract both segments from the URL path after `:comments/`                     |

## Key Management

### List Keys

```bash
seed-cli key list          # Production keyring
seed-cli key list --dev    # Development keyring
```

### Import Key from Mnemonic

```bash
seed-cli key import -n <name> "<12 or 24 word mnemonic>"
seed-cli key import -n <name> --passphrase "optional" "<mnemonic>" --dev
```

### Generate New Key

```bash
seed-cli key generate -n <name> --show-mnemonic
seed-cli key generate -n <name> -w 24 --show-mnemonic --dev
```

### Show Key Details

```bash
seed-cli key show <name-or-id>
seed-cli key show  # Shows default key
```

### Remove Key

```bash
seed-cli key remove <name-or-id> --force
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
seed-cli document get hm://z6Mk.../my-doc

# Structured output
seed-cli document get hm://z6Mk.../my-doc --json

# Write to file
seed-cli document get hm://z6Mk.../my-doc -o doc.md
```

### Block ID Preservation

Block IDs are embedded as HTML comments (`<!-- id:XXXXXXXX -->`). When the output is piped back through
`document update -f`, these IDs enable smart per-block diffing. This enables:

- **Round-trip editing**: Export → edit → update with minimal changes
- **Smart diffing**: `document update -f` matches blocks by ID and only submits changes
- **Stable references**: Block-level links (e.g., `hm://z6Mk.../doc?b=XXXXXXXX`) remain valid after re-import

```bash
# Export, edit, re-import (only changed blocks are submitted)
seed-cli document get hm://z6Mk.../my-doc -o doc.md
# ... edit doc.md ...
seed-cli document update hm://z6Mk.../my-doc -f doc.md --key mykey

# Same works with JSON (block IDs are always present in JSON output)
seed-cli document get hm://z6Mk.../my-doc --json -o doc.json
# ... edit doc.json ...
seed-cli document update hm://z6Mk.../my-doc -f doc.json --key mykey

# Plain markdown (no ID comments) → full body replacement
echo "# New Content" | seed-cli document update hm://z6Mk.../my-doc -f - --key mykey
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
5. **Check key ownership and target account** — The signing key must be the document owner's key or have a delegated
   capability. When the user references a web URL from a specific site/space, verify the signing key matches the space's
   account — if it doesn't, warn the user that the document will be created under their personal account, not the
   referenced space.
6. **Validate parent paths before creating nested documents** — Before publishing at a nested path like `a/b/c`, verify
   that parent documents (`a`, `a/b`) exist under the target account. Missing parents create orphaned documents that
   display with broken/red parent links in the UI.
7. **Read before writing** — Always fetch the document first to understand its current state.
8. **One operation at a time** — Don't batch multiple document updates in a single command.
9. **Verify after publishing** — Read the document again to confirm changes applied correctly.
10. **Never expose mnemonics** — Don't log or display mnemonic phrases in output.
11. **Prefer markdown** — Use markdown with frontmatter for content generation; use JSON blocks only when precise block
    control is needed.
12. **Space publishing with `--account`** — To publish under a shared space/site account, use `--account <uid>` on
    `document create`. The CLI automatically resolves a WRITER or AGENT capability for the signing key on the target
    account. Without `--account`, documents are always published under the signing key's own account. If no matching
    capability exists, the command fails with a descriptive error.

## Server Configuration

Default server: `https://hyper.media`

Override per-command:

```bash
seed-cli --server http://localhost:4000 document create -f content.md --key mykey
```

Or set globally:

```bash
seed-cli config --server http://localhost:4000
```

Environment variable:

```bash
SEED_SERVER=http://localhost:4000 seed-cli document create -f content.md --key mykey
```
