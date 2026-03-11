---
name: seed-hypermedia-read
description:
  Read-only Seed Hypermedia gRPC operations for querying documents, comments, entities, accounts, and server metadata.
  Use when the user wants to fetch or inspect Seed data without writing, updating, or deleting anything.
---

# Seed Hypermedia gRPC Skill

Scope: Read-only gRPC access to Seed Hypermedia. If the user wants to write, update, or delete, refuse and route to the
**seed-hypermedia-write** skill.

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

## Workflow

### 1. Check Server

```bash
grpcurl -plaintext localhost:58002 list  # Try dev first
grpcurl -plaintext localhost:56002 list  # Then production
```

### 2. Initial API Discovery (Once per Session)

Use reflection to discover the API structure for new commands you don't know about. **Important**: Once you've
discovered a service/method structure, you can reause it without doing reflection again. Assume the server does not
change. However if subsequent requests fail (read the error message) and they fail because of structure, then you may do
reflection again.

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

- Extract what Seed operation is needed
- If the request is **write/update/delete**, refuse and route to **seed-hypermedia-write** (do not call any gRPC method)
- Parse any IRIs to get account, path, version, etc.
- If needed service/method is unknown, use reflection to discover it (once)
- Determine if this requires single or multiple calls

### 4. Make RPC Calls

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

### 5. Download media referenced by IPFS

When a document references a media file (audio/video/image/document), it will often be an IPFS URI like:

`ipfs://<cid>`

To download the bytes, use the **local HTTP gateway** (this is not gRPC):

- URL format: `http://localhost:<httpport>/ipfs/<cid>`
- Port mapping: `httpport = grpcport - 1`
	- Dev: gRPC `58002` → HTTP `58001`
	- Production: gRPC `56002` → HTTP `56001`

Example:

`curl -L "http://localhost:58001/ipfs/<cid>" --output /tmp/downloaded-file`
select the extension according to the media type
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

## CLI Export

For exporting documents as markdown (with frontmatter and block IDs), use the Seed CLI instead of gRPC. The CLI's
`document get` command outputs round-trip-compatible markdown by default:

```bash
SEED_CLI="bun run frontend/apps/cli/src/index.ts"

# Default output: markdown with frontmatter and block IDs
$SEED_CLI document get hm://z6Mk.../my-doc

# Write to file
$SEED_CLI document get hm://z6Mk.../my-doc -o doc.md

# Structured output (JSON/YAML)
$SEED_CLI document get hm://z6Mk.../my-doc --json
```

For piping exported markdown back into write operations, see the **seed-hypermedia-write** skill.

## Key Rules

1. **Read-only only** - This skill must never call write/update/delete endpoints. Refuse any request that would modify
   Seed data and route to **seed-hypermedia-write**.
2. **Discover once per session** - Use reflection to learn API structure, then reuse that knowledge. The server won't
   likely change during the session.
3. **Parse IRIs carefully** - Extract all components according to format above
4. **Omit optional fields** - If IRI component is absent, don't send it (not even empty string)
5. **Check signatures before first use** - Use `describe` to understand method parameters
6. **Chain efficiently** - For compound operations, minimize calls while getting needed data
7. **Handle pagination** - Check for page_size/page_token fields, default to 50-100 for page_size
8. **Summarize large responses** - Show key data for responses >10KB
9. **Prefer account names over account IDs** - Do not surface raw account IDs to the user when referring to standalone
   accounts/authors (e.g., in “Author”, “Account”, “Owner” fields). Instead, resolve a human-friendly account name using
   the server’s account lookup/search RPC (discover it via reflection if needed). **Exception:** when displaying a
   Document IRI or Comment IRI (e.g., `hm://<account>/...`), keep the `<account>` portion unchanged because it is part
   of the URL; if helpful, present the resolved display name separately alongside the IRI.

## Response Handling

- Extract key Seed metadata (names, authors, timestamps)
- Explain errors in user-friendly terms
- If method doesn't exist, use reflection to find alternatives
