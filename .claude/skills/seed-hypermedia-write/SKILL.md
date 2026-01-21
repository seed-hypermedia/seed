---
name: seed-hypermedia-write
description: Seed Hypermedia gRPC operations for creating documents and comments, plus read-only similarity lookup before writing. Uses reflection to discover endpoints and request shapes. Supports image uploads via IPFS HTTP.
---

# Seed Hypermedia gRPC Skill

Scope: Create documents and comments, and perform limited read-only lookups to find similar documents before writing. If the user wants to read without writing, route to the **seed-hypermedia-read** skill. If the user wants to update existing content or delete anything, refuse and route to the **seed-hypermedia-delete** skill (future).

## Prerequisites

Check if `grpcurl` is installed:
```bash
which grpcurl
```

If not installed:
```bash
# macOS
brew install grpcurl

# Linux (package manager)
# Debian/Ubuntu
sudo apt-get install grpcurl

# Fedora/RHEL
sudo dnf install grpcurl

# Arch
sudo pacman -S grpcurl

# Or download binary from: https://github.com/fullstorydev/grpcurl/releases
```

Check if `curl` is installed (needed for image uploads):
```bash
which curl
```

## Server Endpoints

Seed gRPC server runs on:
- **Dev**: `localhost:58002`
- **Production**: `localhost:56002`

Check which is available first.

## Hypermedia IRI Format

**Document IRI**: `hm://<account>/<path>?v=<version>#<block>&l`
- Only `<account>` is required (e.g., `z6Mk...`)
- `<path>`: Optional document path
- `?v=<version>`: Optional specific version
- `#<block>`: Optional block ID
- `&l`: Optional latest version flag

**Comment IRI**: `hm://<author>/<tsid>`
- `<author>`: Account identifier
- `<tsid>`: Timestamp-based comment ID

## Content Model (Hierarchy, Blocks, Links, Embeds)

Seed documents are hierarchical: a document is a tree of blocks. Blocks can contain inline marks (bold, italic, code) and may link or embed external media. When creating documents, always think in terms of blocks and their hierarchy rather than a single flat text blob.

Block and annotation types are **case-sensitive** and must match the publishable schema (e.g., `Paragraph`, `Heading`, `Code`, `Image`).

**Blocks (common types)**
- Paragraphs and headings
- Lists (ordered/unordered)
- Blockquotes
- Code blocks
- Images (via `ipfs://<cid>` links)

**Links**
- Inline links use `[label](url)` and are represented as link marks in inline text.

**Embeds**
- Images are represented as image blocks that reference `ipfs://<cid>` URLs.
- Other embed types exist, but this write skill is restricted to images only for now.

**List structure**
- Lists are represented by block hierarchies, not flat paragraphs.
- Use `childrenType: Ordered` or `childrenType: Unordered` on a list container block and nest list item blocks in `children`.

## Simplified Markdown Subset (Supported)

When a user provides a `.md` file, parse it into the block hierarchy using the supported subset below. When the user provides a vague description, generate content in this subset before converting to blocks.

**Block syntax**
- Headings: `#` to `######`
- Unordered lists: `-`, `*`, `+`
- Ordered lists: `1.`
- Blockquotes: `>`
- Code fences: ```lang ... ```

**Inline syntax**
- Bold: `**bold**` or `__bold__`
- Italic: `*italic*` or `_italic_`
- Inline code: `` `code` ``
- Links: `[text](url)`
- Images: `![alt](ipfs://<cid>)`

**Notes**
- Prefer multiple paragraphs and clear sectioning.
- Use bold and italics for emphasis.
- Use bullet points and numbered lists where appropriate.
- Use code blocks for any code.
- Convert code fences to `Code` blocks with optional `language`.

## Workflow

### 1. Check Server
```bash
grpcurl -plaintext localhost:58002 list  # Try dev first
grpcurl -plaintext localhost:56002 list  # Then production
```

### 2. Initial API Discovery (Once per Session)

Use reflection to discover the write APIs and message schemas. **Important**: Always do reflection before the first write call in a session. If any write call fails due to schema mismatch, run reflection again and update the request shape.

```bash
# List all services
grpcurl -plaintext <host:port> list

# Describe a service to see its methods
grpcurl -plaintext <host:port> describe <service.name>

# Describe a method to see its signature
grpcurl -plaintext <host:port> describe <service.name.MethodName>

# Describe message structure to see required fields
grpcurl -plaintext <host:port> describe <message.type>
```

### 3. Parse User Intent
- Determine whether the user is creating a document or a comment.
- If the user wants to update or delete existing content, refuse and route to the **write-seed-hypermedia** skill (future).
- If the user provided a `.md` file, parse it into the simplified markdown subset and convert to blocks.
- If the user provided a vague description, generate structured markdown first, then convert to blocks.
- If the content includes images, upload them via the IPFS HTTP endpoint and reference them with `ipfs://<cid>`.
- Before writing a document, run a similarity search and read 2–3 similar documents, then add links only if they are truly relevant.
- When creating a document, publish it directly to a path.
- The user can choose the path and title.
- If the user did not provide a path, default to `notes/<YYYY-MM-DD>-<slug>` (slug derived from the content).
- If the user did not provide a title, infer a short, descriptive title from the content.
- Once the document content is ready, set the title and add metadata with a short description.

### 4. Image Upload (IPFS HTTP, Images Only)

This is the only HTTP call used by this skill. It returns a CID as plain text. Use the CID as `ipfs://<cid>` in image blocks.

```bash
curl -F "file=@/path/to/image.png" http://localhost:58002/ipfs/file-upload
```

### 5. Similarity Search (Read Before Write)

Before writing a document, use the search endpoints to find similar documents. Use **one keyword per call**, then read 2–3 of the closest matches.

Rules:
- Always use reflection to discover search and read methods.
- Use one keyword per call (no multi-term queries).
- Read at least 2–3 similar documents if available.
- Only add citations if they are **really relevant** after reading.
- Add citations as inline links to the referenced document IRI.

### 6. Make gRPC Calls

**Create document**
- Use reflection to find the document creation RPC (commonly named similar to `CreateDocumentChange`).
- Required fields usually include: account, path, changes (block hierarchy), and signing key name.
- Publish directly to the final path.
- The user can set the path and title.
- If no path is provided, use `notes/<YYYY-MM-DD>-<slug>`.
- If no title is provided, infer a clear, concise title from the content.
- After content is finalized, set the document title and attach document metadata with a concise description.
- Optional fields may include base version, timestamp, or delegation key details. Only include if provided.

**Create comment**
- Use reflection to find the comment creation RPC (commonly named similar to `CreateComment`).
- Required fields usually include: target account, target path, target version, content blocks, and signing key name.
- Optional fields may include reply parent or embed blocks.

**Single operation**:
```bash
grpcurl -plaintext -d '{"field": "value"}' <host:port> <service/Method>
```

**Compound operations** (multiple dependent calls):
```bash
# Get data from first call
RESULT=$(grpcurl -plaintext -d '{...}' <host:port> <service1/Method1>)

# Extract needed field using jq
VALUE=$(echo "$RESULT" | jq -r '.fieldName')

# Use in next call
grpcurl -plaintext -d "{\"field\": \"$VALUE\"}" <host:port> <service2/Method2>
```

## IRI Parsing

**Document IRI** `hm://<account>/<path>?v=<version>#<block>&l`:
- `account`: Text after `hm://` until first `/`, `?`, `#`, or `&`
- `path`: Text after first `/` until `?`, `#`, or `&` (empty string if absent)
- `version`: Value after `?v=` (if present)
- `block`: Value after `#` (if present)
- `latest`: Check for `&l` flag

**Comment IRI** `hm://<author>/<tsid>`:
- `author`: Text after `hm://` until `/`
- `tsid`: Text after `/`

## Key Rules

1. **Write-first with limited reads** - This skill may read only for similarity search and required citations. For pure reading, route to **seed-hypermedia-read**.
2. **No updates/deletes** - Refuse any request to update or delete; route to **write-seed-hypermedia** (future).
3. **Reflection first** - Always use reflection to discover method names and request shapes before writing or searching.
4. **Omit optional fields** - If a field is absent, omit it entirely (do not send empty strings).
5. **Markdown first** - Build content as simplified markdown, then convert to blocks.
6. **Images only** - Only allow image uploads via IPFS; embed using `ipfs://<cid>`.
7. **Cite only if relevant** - Add links to similar documents only when they are truly relevant after reading.
8. **Summarize on errors** - Explain schema or validation errors in plain language and re-run reflection if needed.

## Common Gotchas (Observed)

- **`grpcurl` missing**: `which grpcurl` may fail. Install it and ensure `$HOME/go/bin` is in `PATH`.
- **Dev server not running**: `localhost:58002` may refuse connections. Fall back to `localhost:56002`.
- **`grpcurl -d @file` fails**: `grpcurl` does not accept `@/path` JSON shorthand. Use `-d "$(cat /path/to.json)"`.
- **Path must start with `/`**: document paths like `drafts/...` are invalid. Use `/drafts/...`.
- **Signing key required**: `named key not found` means the `signing_key_name` is missing or invalid. Use `Daemon/ListKeys` and set the correct key name.
- **Large account lists**: `ListAccounts` can be huge. Filter if possible, or pick the correct account intentionally.
- **Invalid block types**: Use publishable block types with correct casing (e.g., `Paragraph`, `Heading`, `Code`, `Image`). Types like `paragraph` or `code-block` will fail validation.
- **Invalid annotation types**: Use `Bold`, `Italic`, `Underline`, `Strike`, `Code`, `Link`, or `Embed`. `Link`/`Embed` annotations must include a `link` field.
- **List shape**: Lists must be represented as a parent block with `childrenType` and nested `children`, not flat paragraphs.

## Response Handling

- Extract key metadata (document IRI, comment IRI, timestamps).
- Summarize what was created in 1–3 bullet points.
- Note any citations added and why they were relevant.
- Explain errors in user-friendly terms and retry only after reflection.
