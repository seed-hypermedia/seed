# Agent write tool CLI-parity plan

This document plans a unified model-facing Seed write tool for Agents. The tool should expose the complete Seed write
surface in a way that is easy for a model to call while staying as close as possible to the Seed CLI command model.

The core idea is one tool:

```ts
write(input)
```

The tool must be implemented with the same TypeScript SDK/shared code paths used by the CLI and desktop where possible.
It must not shell out to `seed-cli`, `npx`, or any other command-line process.

## Goals

- Provide one model-facing tool for all Seed writes.
- Keep command names, option names, value shapes, and behavior as close to the CLI as possible.
- Support the complete write surface:
  - documents, including document changes and refs;
  - document drafts;
  - markdown/frontmatter conversion;
  - JSON block input;
  - comments;
  - capabilities;
  - contacts;
  - profiles.
- Use agent-selected server-side HM account keys for signing.
- Let users refer to signing identities by profile name while the implementation signs with the public key account ID.
- Keep writes auditable through durable session tool events.
- Support `dryRun` where practical so agents can stage or preview write operations before publishing.

## Non-goals

- Do not invoke the CLI through `child_process`, `bun`, `npx`, temp files, or shell commands.
- Do not use desktop-local keyrings or local CLI accounts.
- Do not let a tool call use every account key owned by the user. The tool may only use keys selected on the agent.
- Do not invent new protocol semantics when the CLI or TS SDK already has a meaning for an operation.
- Do not expose low-level internals like `publish_blobs` as separate model-facing tools unless future product direction
  explicitly calls for that.

## Guiding principle: structured CLI parity

The model-facing API should be a structured form of CLI commands. Instead of exposing many tiny tools, the single tool
routes by a CLI-like command name:

```ts
type WriteHypermediaInput = {
  command: WriteCommand
  signer?: SignerSelector
  server?: string
  dev?: boolean
  dryRun?: boolean
  input?: Record<string, unknown>
}
```

Example:

```ts
await write({
  command: 'document.create',
  signer: {profileName: 'Docs Bot'},
  input: {
    content: '# Hello\n\nThis is a new Seed document.',
    format: 'markdown',
    visibility: 'PUBLIC',
  },
})
```

Where possible, field names inside `input` should mirror CLI option names. If the CLI uses `--location`, the tool should
prefer `location` over a new synonym like `parent`. If the CLI uses `--edit`, the tool should prefer `edit` over
`document`.

## Required CLI audit before implementation

Before implementation, inspect the CLI and shared packages to create an exact command map. The current expected source
locations are:

- `frontend/apps/cli/src/**`
- `frontend/packages/client/src/**`
- `frontend/packages/shared/src/**`
- `frontend/packages/editor/src/**`

The audit must cover:

- document create/update/publish behavior;
- document refs and redirects;
- draft create/update/get/list/delete/publish behavior;
- markdown/frontmatter parsing;
- JSON block parsing;
- comment create/update/delete behavior;
- capability create/grant/revoke behavior;
- contact create/update/delete or follow/unfollow behavior;
- profile update/alias behavior;
- publish APIs used by each command;
- output shape and error behavior.

The audit should populate this table with exact command names and helpers:

| CLI command                  | Tool command        | CLI flags/options | Existing TS helper     | Extraction needed | Notes                                        |
| ---------------------------- | ------------------- | ----------------- | ---------------------- | ----------------- | -------------------------------------------- |
| `seed document create ...`   | `document.create`   | TBD               | TBD                    | TBD               | Must publish changes and refs.               |
| `seed document update ...`   | `document.update`   | TBD               | TBD                    | TBD               | Must support markdown conversion.            |
| `seed document ref ...`      | `document.ref`      | TBD               | TBD                    | TBD               | Exact ref fields must match SDK/CLI.         |
| `seed document redirect ...` | `document.redirect` | TBD               | TBD                    | TBD               | Include only if CLI supports it.             |
| `seed draft create ...`      | `draft.create`      | TBD               | TBD                    | TBD               | Server-side agent draft storage.             |
| `seed draft update ...`      | `draft.update`      | TBD               | TBD                    | TBD               | Preserve unspecified draft fields.           |
| `seed draft get ...`         | `draft.get`         | TBD               | TBD                    | TBD               | Size-limited output.                         |
| `seed draft list ...`        | `draft.list`        | TBD               | TBD                    | TBD               | Account-scoped listing.                      |
| `seed draft delete ...`      | `draft.delete`      | TBD               | TBD                    | TBD               | Keep audit/status decision open.             |
| `seed draft publish ...`     | `draft.publish`     | TBD               | TBD                    | TBD               | Publishes changes and refs.                  |
| `seed comment create ...`    | `comment.create`    | TBD               | TBD                    | TBD               | Replies may be a flag or command.            |
| `seed comment update ...`    | `comment.update`    | TBD               | TBD                    | TBD               | Match comment edit semantics.                |
| `seed comment delete ...`    | `comment.delete`    | TBD               | TBD                    | TBD               | Match tombstone/delete semantics.            |
| `seed capability ...`        | `capability.*`      | TBD               | TBD                    | TBD               | Do not invent revoke if unsupported.         |
| `seed contact ...`           | `contact.*`         | TBD               | TBD                    | TBD               | Clarify contact vs follow terminology.       |
| `seed profile update ...`    | `profile.update`    | TBD               | `createProfile` likely | TBD               | Reuse server-side profile publishing helper. |
| `seed profile alias ...`     | `profile.alias`     | TBD               | TBD                    | TBD               | Include only if CLI/SDK supports it.         |

## Signer selection and identity context

Agents already allow each agent definition to select multiple server-side HM account keys:

```ts
type AgentDefinition = {
  tools?: string[]
  signingKey?: string // legacy single-key field
  signingKeys?: string[]
}
```

The write tool may only use identities selected in `signingKeys`, falling back to legacy `signingKey` for old agents.

Model-facing signer selector:

```ts
type SignerSelector = {profileName: string} | {publicKey: string}
```

Resolution rules:

1. If `publicKey` is supplied, it must match the public key/account ID of one selected signing identity.
2. If `profileName` is supplied, it must exactly match one selected identity label.
3. If no signer is supplied and exactly one identity is selected, use that identity.
4. If no signer is supplied and multiple identities are selected, return a structured error asking for a signer.
5. If a profile name matches more than one selected identity, return a structured ambiguity error and list matching
   public keys.
6. Never resolve a signer outside the selected signing identities.
7. Never return or log private key material.

When write tools are enabled, append selected identities to the agent system prompt:

```xml
<available_signing_identities>
[
  {
    "profileName": "Docs Bot",
    "publicKey": "z6Mk..."
  }
]
</available_signing_identities>
```

Prompt guidance should say:

> Use `write` for Seed write operations. Users may refer to signing identities by profile name. Signing uses the public
> key account ID. If a requested identity is ambiguous, ask for clarification or use the public key.

## Tool registration and permissions

Supported Seed tool names should include:

```ts
'read'
'write'
```

Permission behavior:

- Legacy agents with `tools` omitted keep the old default: `read` only.
- `write` is never enabled by default.
- The desktop Tools tab should expose a separate toggle for `write`.
- The write tool should be callable only when the agent definition includes `write`.
- Even when enabled, write operations requiring signatures should fail clearly if no signing identities are selected.

## Proposed command set

Exact names should be finalized after the CLI audit. The initial target set is:

```ts
type WriteCommand =
  // Drafts
  | 'draft.create'
  | 'draft.update'
  | 'draft.get'
  | 'draft.list'
  | 'draft.delete'
  | 'draft.publish'

  // Documents
  | 'document.create'
  | 'document.update'
  | 'document.ref'
  | 'document.redirect'

  // Comments
  | 'comment.create'
  | 'comment.update'
  | 'comment.delete'

  // Capabilities
  | 'capability.grant'
  | 'capability.revoke'

  // Contacts
  | 'contact.create'
  | 'contact.update'
  | 'contact.delete'

  // Profiles
  | 'profile.update'
  | 'profile.alias'
```

If the CLI uses materially different words, prefer the CLI names unless they are too ambiguous for model use. In that
case, document the intentional mismatch in the command map.

## Common input envelope

Every write command should use the same outer envelope:

```ts
type WriteHypermediaInput = {
  command: WriteCommand
  signer?: SignerSelector
  server?: string
  dev?: boolean
  dryRun?: boolean
  input?: Record<string, unknown>
}
```

Field meanings:

- `command`: CLI-like command name.
- `signer`: selected profile name or public key.
- `server`: optional publish/resolve server override if CLI supports this. Otherwise omit or reject.
- `dev`: optional dev server flag if CLI supports this.
- `dryRun`: validate and prepare the write without publishing blobs or mutating server state.
- `input`: command-specific options, named to match CLI flags.

## Common output envelope

The tool should return structured output instead of CLI prose:

```ts
type WriteHypermediaResult = {
  type: 'hypermedia_write_result'
  command: WriteCommand
  signer?: {
    profileName: string
    publicKey: string
  }
  server: string
  dryRun?: boolean
  id?: string
  version?: string
  url?: string
  cids?: string[]
  draftId?: string
  commentId?: string
  capabilityId?: string
  contactId?: string
  profile?: {
    name?: string
    publicKey: string
  }
  warnings?: string[]
  message: string
}
```

Expected domain errors should return structured errors when possible:

```ts
type WriteHypermediaError = {
  type: 'hypermedia_write_error'
  command?: WriteCommand
  message: string
  details?: Record<string, unknown>
}
```

Unexpected implementation failures can still surface as tool execution errors, but common user/model errors should be
machine-readable.

## Markdown and document content conversion

Document writes and drafts must support CLI-equivalent markdown conversion.

Supported content formats:

```ts
type DocumentContentFormat = 'markdown' | 'json'
```

Possible future formats, only if the CLI path is safely extractable:

```ts
type FutureDocumentContentFormat = 'pdf'
```

### Markdown input

Example:

```ts
{
  command: 'document.create',
  signer: {profileName: 'Docs Bot'},
  input: {
    content: '---\nname: My Doc\nsummary: Short summary\n---\n# My Doc\n\nHello.',
    format: 'markdown',
    visibility: 'PUBLIC'
  }
}
```

Markdown conversion must support the same frontmatter fields as the CLI. The exact list must be confirmed in the CLI
audit. Expected fields include:

```yaml
---
name: My Document Title
summary: A short summary
displayAuthor: Jane Doe
displayPublishTime: 2026-05-14
cover: ipfs://...
icon: ipfs://...
showOutline: true
showActivity: true
contentWidth: M
layout: Seed/Default
---
```

The parser should produce:

```ts
type ParsedDocumentContent = {
  metadata: HMMetadata
  blocks: HMBlockNode[]
}
```

Open questions to answer during audit:

- Does frontmatter `name` override the first Markdown heading?
- If no frontmatter name exists, does the first heading become metadata name?
- Are unsupported frontmatter keys preserved, ignored, or rejected?
- Are images uploaded/imported during markdown conversion, or are existing URLs required?
- Does CLI normalize headings or block IDs in a specific way?

### JSON block input

The tool should also support JSON block input for CLI parity and advanced users:

```ts
{
  command: 'document.create',
  input: {
    content: [{type: 'Paragraph', text: 'Hello'}],
    format: 'json',
    metadata: {name: 'Hello'}
  }
}
```

It should accept either:

- already-parsed JSON values; or
- a string containing JSON, if the CLI accepts JSON file content.

Validation must ensure the result is a valid HM document block tree.

### Shared conversion module

If markdown/frontmatter conversion currently lives inside CLI command handlers, extract it to a shared module used by
both CLI and Agents. Preferred destination after audit:

```text
frontend/packages/client/src/document-content.ts
```

Possible exports:

```ts
export type ParsedDocumentContent = {
  metadata: HMMetadata
  blocks: HMBlockNode[]
}

export function parseDocumentContent(input: {
  content: string | unknown
  format?: 'markdown' | 'json'
  metadata?: Partial<HMMetadata>
}): ParsedDocumentContent
```

Agents should depend on this shared module, not on CLI command files.

## Draft mode

The write tool must support document draft workflows equivalent to the CLI draft model.

Important product decision: agent drafts should be server-side drafts owned by the Agents service, not desktop-local CLI
or app draft files.

Rationale:

- Agents may run on a remote server.
- The desktop draft directory is local to a user machine.
- Agent sessions need durable replay and continuity on the server.
- Drafts created by an agent should be available to future agent runs against the same server.

This is semantic CLI parity, not storage parity.

### Draft storage

Add an Agents service table similar to:

```sql
CREATE TABLE agent_drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  agent_id TEXT,
  signer_secret_name TEXT,
  title TEXT,
  content_format TEXT NOT NULL,
  content_cbor BLOB NOT NULL,
  metadata_cbor BLOB,
  edit_target TEXT,
  location_target TEXT,
  path_name TEXT,
  visibility TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  published_id TEXT,
  published_version TEXT
);
```

Index recommendations:

```sql
CREATE INDEX agent_drafts_account_updated_idx ON agent_drafts(account_id, updated_at DESC);
CREATE INDEX agent_drafts_agent_updated_idx ON agent_drafts(account_id, agent_id, updated_at DESC);
CREATE INDEX agent_drafts_status_idx ON agent_drafts(account_id, status);
```

`status` values:

```ts
type DraftStatus = 'idle' | 'published' | 'deleted'
```

A hard delete can still be implemented, but retaining `published` and `deleted` statuses is useful for auditability and
session continuity.

### `draft.create`

Tool input:

```ts
{
  command: 'draft.create',
  signer?: SignerSelector,
  input: {
    content: string | HMBlockNode[]
    format?: 'markdown' | 'json'
    edit?: string
    location?: string
    visibility?: 'PUBLIC' | 'PRIVATE'
    path?: string
    name?: string
    metadata?: DocumentMetadataInput
  }
}
```

Behavior:

- Parse markdown/frontmatter or JSON blocks.
- Store parsed content and metadata in `agent_drafts`.
- Store routing metadata:
  - `edit` for updating an existing document;
  - `location` for creating under a parent/location;
  - `path` or equivalent CLI field;
  - `visibility`.
- Do not publish blobs.
- If `signer` is supplied, store the selected signer secret name as the intended publishing account.
- If `signer` is omitted, allow draft creation but require/resolve signer at publish time unless CLI semantics require a
  key earlier.

Output:

```ts
{
  type: 'hypermedia_write_result',
  command: 'draft.create',
  draftId: '...',
  message: 'Draft created'
}
```

### `draft.update`

Tool input:

```ts
{
  command: 'draft.update',
  input: {
    draft: string
    content?: string | HMBlockNode[]
    format?: 'markdown' | 'json'
    edit?: string | null
    location?: string | null
    visibility?: 'PUBLIC' | 'PRIVATE'
    path?: string | null
    name?: string | null
    metadata?: DocumentMetadataInput
  }
}
```

Behavior:

- Load an existing account-owned draft.
- Modify content and/or routing metadata.
- Preserve unspecified fields.
- Treat explicit `null` as clearing optional fields where CLI semantics allow clearing.
- Update `updated_at`.

### `draft.get`

Tool input:

```ts
{
  command: 'draft.get',
  input: {
    draft: string
    format?: 'markdown' | 'json'
  }
}
```

Behavior:

- Return draft metadata and content.
- If `format: 'json'`, return blocks and metadata.
- If `format: 'markdown'`, return markdown only if there is a shared block-to-markdown converter matching CLI behavior.
  Otherwise return JSON and a warning.
- Bound output size. Large drafts should return metadata plus a truncation warning.

### `draft.list`

Tool input:

```ts
{
  command: 'draft.list',
  input?: {
    limit?: number
    status?: 'idle' | 'published' | 'deleted'
  }
}
```

Behavior:

- List account-owned drafts.
- Prefer current agent drafts first if `agent_id` is stored.
- Include title, status, routing fields, updated time, published target/version if present.

### `draft.delete`

Tool input:

```ts
{
  command: 'draft.delete',
  input: {
    draft: string
  }
}
```

Behavior:

- Mark the draft deleted or hard-delete depending on final product choice.
- Return a structured result.
- Do not contact the HM server.

### `draft.publish`

Tool input:

```ts
{
  command: 'draft.publish',
  signer?: SignerSelector,
  input: {
    draft: string
    expectedVersion?: string
  }
}
```

Behavior:

- Load an account-owned draft.
- Resolve signer from request, stored intended signer, or selected identity defaults.
- Publish as:
  - update if `edit` is set;
  - child/location create if `location` is set;
  - root document create otherwise.
- Publish document changes and refs.
- Mark draft as published with `published_at`, `published_id`, and `published_version`.
- Return canonical HM ID/URL/version.

## Documents: changes and refs

Document commands must publish both document changes and refs where CLI semantics require both.

All direct document publish commands should use one internal helper also used by `draft.publish`:

```ts
async function publishDocumentFromParsedContent(input: {
  client: SeedClient
  signer: ResolvedSigner
  content: ParsedDocumentContent
  edit?: string
  location?: string
  path?: string
  visibility?: 'PUBLIC' | 'PRIVATE'
  expectedVersion?: string
  dryRun?: boolean
}): Promise<DocumentPublishResult>
```

Responsibilities:

1. Resolve `edit` or `location` HM IDs.
2. Determine whether the operation is a genesis/create, child create, or update.
3. Create the correct document change blobs.
4. Sign changes with the selected server-side HM key.
5. Create or update refs as the CLI would.
6. Publish all required blobs to the configured HM server.
7. Return canonical ID, version, refs, and CIDs.

### `document.create`

Tool input:

```ts
{
  command: 'document.create',
  signer?: SignerSelector,
  input: {
    content: string | HMBlockNode[]
    format?: 'markdown' | 'json'
    location?: string
    visibility?: 'PUBLIC' | 'PRIVATE'
    path?: string
    name?: string
    metadata?: DocumentMetadataInput
  }
}
```

Behavior:

- Parse content.
- If `location` is set, create under that location according to CLI semantics.
- If `location` is omitted, create a root/top-level document according to CLI semantics.
- Publish changes and refs.

### `document.update`

Tool input:

```ts
{
  command: 'document.update',
  signer?: SignerSelector,
  input: {
    edit: string
    content: string | HMBlockNode[]
    format?: 'markdown' | 'json'
    visibility?: 'PUBLIC' | 'PRIVATE'
    expectedVersion?: string
    name?: string
    metadata?: DocumentMetadataInput
  }
}
```

Behavior:

- Resolve the document named by `edit`.
- If `expectedVersion` is supplied and current latest version differs, return a structured conflict error.
- Parse content.
- Publish changes and refs.

### `document.ref`

Tool input must mirror the exact CLI/SDK ref structure. A provisional shape:

```ts
{
  command: 'document.ref',
  signer?: SignerSelector,
  input: {
    space: string
    path?: string
    genesis: string
    version: string
    generation?: number
    capability?: string
  }
}
```

Behavior:

- Create a version ref exactly as the CLI does.
- Publish the ref blob.
- Return ref CID and target version.

### `document.redirect`

Include only if supported by CLI/SDK. Provisional shape:

```ts
{
  command: 'document.redirect',
  signer?: SignerSelector,
  input: {
    space: string
    path?: string
    target: string
    generation?: number
    capability?: string
  }
}
```

Behavior:

- Create a redirect ref exactly as the CLI does.
- Publish the ref blob.

## Comments

Commands should mirror the CLI after audit. Initial expected commands:

```ts
'comment.create'
'comment.update'
'comment.delete'
```

Potential reply support should follow CLI naming. If CLI uses `comment create --reply-to`, do not add a separate
`comment.reply` command unless it materially improves model use. Prefer CLI parity.

### `comment.create`

Provisional input:

```ts
{
  command: 'comment.create',
  signer?: SignerSelector,
  input: {
    target: string
    content: string
    format?: 'markdown' | 'text' | 'json'
    blockId?: string
    replyTo?: string
  }
}
```

### `comment.update`

```ts
{
  command: 'comment.update',
  signer?: SignerSelector,
  input: {
    comment: string
    content: string
    format?: 'markdown' | 'text' | 'json'
  }
}
```

### `comment.delete`

```ts
{
  command: 'comment.delete',
  signer?: SignerSelector,
  input: {
    comment: string
  }
}
```

Implementation should use or extract shared helpers from the TS client/comment modules. It must preserve CLI semantics
for comment IDs, replies, tombstones, and block targets.

## Capabilities

The write tool must support capability writes. Do not invent revoke/delete behavior if the CLI or protocol does not
support it; the audit must determine exact semantics.

Initial expected commands:

```ts
'capability.grant'
'capability.revoke'
```

Provisional grant input:

```ts
{
  command: 'capability.grant',
  signer?: SignerSelector,
  input: {
    delegate: string
    role?: string
    path?: string
    label?: string
    audience?: string
    expiration?: string
  }
}
```

Open questions:

- What role names does the CLI expose?
- Are capabilities path-scoped, document-scoped, or account-scoped in the CLI?
- Is revoke implemented as a new blob, a tombstone, a ref, or not supported?
- Are capabilities published to the same server with normal blob publishing?

## Contacts

The write tool must support contact writes. Exact command names should match the CLI. The CLI may use words like
`contact`, `follow`, or `unfollow`; choose parity after audit.

Initial expected commands:

```ts
'contact.create'
'contact.update'
'contact.delete'
```

Provisional create/update input:

```ts
{
  command: 'contact.create',
  signer?: SignerSelector,
  input: {
    subject: string
    name?: string
    profile?: boolean
    site?: boolean
  }
}
```

```ts
{
  command: 'contact.update',
  signer?: SignerSelector,
  input: {
    contact: string
    name?: string
    profile?: boolean
    site?: boolean
  }
}
```

```ts
{
  command: 'contact.delete',
  signer?: SignerSelector,
  input: {
    contact: string
  }
}
```

Open questions:

- Does the CLI distinguish following an account from creating a contact blob?
- Are local subscriptions involved, or only published contact blobs?
- Does delete mean tombstone, replacement, or local removal?

## Profiles

Profiles are both a standalone write domain and part of account management.

Expected commands:

```ts
'profile.update'
'profile.alias'
```

`profile.alias` should only be included if the CLI/SDK supports profile aliases.

### `profile.update`

Input:

```ts
{
  command: 'profile.update',
  signer?: SignerSelector,
  input: {
    name?: string
    description?: string
    icon?: string
  }
}
```

Behavior:

- Resolve signer.
- Create a profile blob with the selected key.
- Publish it to the configured HM server.
- If the signer corresponds to a managed server-side key and `name` changes, update secret metadata label so the UI and
  future prompt context use the new profile name.

### `profile.alias`

Provisional input:

```ts
{
  command: 'profile.alias',
  signer?: SignerSelector,
  input: {
    alias: string
  }
}
```

Finalize only after CLI audit.

## Dry-run semantics

`dryRun: true` should be supported for as many commands as possible.

Dry-run should:

- validate input;
- resolve signer;
- resolve targets where safe;
- parse markdown/frontmatter;
- prepare blobs or preview data;
- return planned CIDs/targets/warnings where possible;
- not call the HM server publish endpoint;
- not mutate local draft state except for explicitly local draft commands where dry-run means preview only.

For draft commands:

- `draft.create` with `dryRun` should parse and validate but not insert a row.
- `draft.update` with `dryRun` should preview changed fields but not update the row.
- `draft.delete` with `dryRun` should confirm that the draft exists but not delete it.
- `draft.publish` with `dryRun` should prepare publish data but not publish or mark the draft published.

If a command cannot faithfully dry-run in v1, it should return a structured error or warning rather than pretending.

## Validation and limits

All tool input is an external boundary and must be validated there.

Recommended limits:

- command string: known command only;
- signer profile/public key: bounded string length;
- markdown content: bounded, e.g. 256 KiB initially;
- JSON blocks: bounded by JSON size and normalized block count;
- metadata: bounded by encoded byte size;
- draft list limit: bounded, e.g. max 100;
- path/name: bounded and validated according to CLI rules;
- server URL: only HTTP/HTTPS if overrides are allowed.

Avoid repeating defensive normalization in deep helper functions. Normalize at the tool boundary, then pass typed values
internally.

## Internal architecture

Add a dedicated implementation module to keep `api-service.ts` from becoming too large:

```text
agents/src/write-tool.ts
```

Possible exports:

```ts
export type WriteToolContext = {
  db: Database
  accountId: string
  agentId: string
  definition: api.AgentDefinition
  hmServerUrl: string
}

export function createWriteHypermediaPiTool(context: WriteToolContext): PiToolDefinition
```

If implementation becomes too large, split by domain only when it improves ownership:

```text
agents/src/write-tool.ts
agents/src/write-tool-documents.ts
agents/src/write-tool-identity.ts
```

Start minimal and avoid many tiny modules.

Core flow:

```ts
async function executeWriteTool(context: WriteToolContext, rawInput: unknown) {
  const input = normalizeWriteInput(rawInput)

  switch (input.command) {
    case 'draft.create':
      return createDraft(context, input)
    case 'draft.publish': {
      const signer = await resolveWriteSigner(context, input.signer)
      return publishDraft(context, signer, input)
    }
    case 'profile.update': {
      const signer = await resolveWriteSigner(context, input.signer)
      return updateProfile(context, signer, input)
    }
    default:
      return unsupportedCommand(input.command)
  }
}
```

## Shared signing helpers

Create shared server-side helpers for agent signing identities. These can live near the write tool or in
`api-service.ts` until they need reuse.

Suggested types:

```ts
type AgentSigningIdentityMetadata = {
  secretName: string
  profileName: string
  publicKey: string
}

type ResolvedAgentSigner = AgentSigningIdentityMetadata & {
  keyPair: NobleKeyPair
}
```

Suggested functions:

```ts
listAgentSigningIdentityMetadata(db, accountId, allowedSecretNames): AgentSigningIdentityMetadata[]
resolveWriteSigner(db, accountId, allowedSecretNames, selector): ResolvedAgentSigner
loadSigningIdentityKeyPair(db, accountId, secretName): NobleKeyPair
```

These helpers should:

- filter by account ID;
- filter by selected secret names;
- verify `metadata.kind === 'hm-account-key'`;
- use metadata `accountId` as public key;
- use metadata `label` as profile name;
- decrypt the seed only after the signer is resolved;
- never return raw seed values.

## Publish client

Use the TypeScript SDK/shared client:

```ts
createSeedClient(hmServerUrl)
```

Use shared blob/document/comment/capability/contact/profile helpers from the packages used by CLI. If CLI-only logic is
needed, extract it to a shared package first.

The Agents service should not depend on CLI command handlers directly.

## UI changes

The Tools tab should expose:

- `read` toggle;
- `write` toggle;
- multi-select signing identities;
- profile names and public keys for each identity;
- inline new-account panel.

When `write` is enabled without selected signing identities, the UI should show a warning. The server should still
enforce this at runtime.

Manage accounts should continue supporting:

- create server-side HM account key;
- publish profile blob on create;
- rename/publish profile blob;
- delete key.

Recommended safety improvement: block deleting a signing identity if any agent still references it in `signingKeys`, or
remove it from affected agents in the same transaction. Blocking is safer for v1.

## Tool result rendering

Initial fallback JSON rendering is acceptable, but write results should receive first-class rendering soon because users
need trust and visibility around writes.

Render fields:

- command;
- signer profile name;
- signer public key;
- dry-run status;
- draft ID;
- document ID/version/URL;
- comment/capability/contact/profile IDs;
- published CIDs;
- warnings/errors.

## Auditability

For v1, durable session events are the audit log:

- tool call input;
- tool result output;
- errors.

Longer-term, consider a dedicated table:

```sql
CREATE TABLE agent_write_audit (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  signer_account_id TEXT,
  signer_secret_name TEXT,
  command TEXT NOT NULL,
  target TEXT,
  result_cbor BLOB,
  created_at INTEGER NOT NULL
);
```

A dedicated audit table is not required for initial implementation if durable session events are reliable and easy to
inspect.

## Implementation phases

### Phase 0: CLI audit

- Read CLI command implementations for all write domains.
- Fill in the command map table in this document.
- Identify reusable TS SDK/shared helpers.
- Identify CLI-local logic that must be extracted.
- Confirm exact command names and field names.

### Phase 1: content conversion extraction

- Extract markdown/frontmatter and JSON block parsing into a shared module if needed.
- Update CLI to use the shared module if it was previously command-local.
- Add unit tests for markdown/frontmatter conversion.

### Phase 2: tool shell and signer resolution

- Add `write` as a known Seed tool.
- Register the Pi tool when enabled on the agent.
- Add signer resolution by profile name/public key.
- Return structured errors for missing, ambiguous, or unselected signers.
- Add tests for signer resolution and permission enforcement.

### Phase 3: server-side drafts

- Add `agent_drafts` persistence.
- Implement:
  - `draft.create`
  - `draft.update`
  - `draft.get`
  - `draft.list`
  - `draft.delete`
- Support `dryRun` for draft commands.
- Add account-scoping tests.

### Phase 4: profiles

- Refactor existing profile publishing helper for reuse.
- Implement `profile.update`.
- Implement `profile.alias` only if CLI/SDK supports it.
- Ensure profile name changes update managed signing identity metadata.

### Phase 5: documents and draft publish

- Implement shared `publishDocumentFromParsedContent`.
- Implement:
  - `document.create`
  - `document.update`
  - `document.ref`
  - `document.redirect` if supported
  - `draft.publish`
- Ensure document create/update publishes both changes and refs.
- Support markdown and JSON input.
- Support conflict detection via `expectedVersion` if CLI/SDK semantics allow it.

### Phase 6: comments

- Implement comment create/update/delete using shared SDK helpers.
- Preserve reply semantics according to CLI.
- Support CLI-equivalent content parsing for comments.

### Phase 7: capabilities and contacts

- Implement capability commands exactly as supported by CLI/SDK.
- Implement contact commands exactly as supported by CLI/SDK.
- Document any unsupported revoke/delete semantics instead of inventing behavior.

### Phase 8: UI rendering and safety hardening

- Add rich write tool result rendering.
- Add warnings in Tools tab for write tool without selected signers.
- Add deletion guard for signing identities used by agents.
- Consider optional dry-run-first policy.
- Consider dedicated write audit table.

## Test plan

### CLI parity tests

After the audit, write tests that verify equivalent inputs produce equivalent SDK calls or blobs for CLI and tool shared
helpers where practical.

### Content conversion tests

- Markdown heading becomes title if CLI does that.
- Frontmatter metadata is parsed correctly.
- Frontmatter overrides or merges according to CLI semantics.
- JSON block input validates.
- Invalid JSON returns a clear error.
- Oversized content is rejected.

### Signer tests

- Single selected signer can be omitted.
- Multiple selected signers require explicit signer.
- Signer by profile name works.
- Signer by public key works.
- Ambiguous profile name returns structured error.
- Unselected public key is rejected.
- Missing/deleted secret is rejected.

### Draft tests

- `draft.create` stores parsed markdown and metadata.
- `draft.update` preserves unspecified fields.
- `draft.get` returns bounded content.
- `draft.list` is account-scoped.
- `draft.delete` marks or removes the draft.
- `draft.publish` publishes changes and refs.
- `dryRun` draft commands do not mutate state.

### Document tests

- `document.create` from markdown publishes changes and refs.
- `document.create` with `location` creates the correct child/location ref.
- `document.update` from markdown publishes changes and refs.
- `document.update` with stale `expectedVersion` returns conflict.
- `document.ref` publishes a ref blob.
- `document.redirect` publishes redirect ref if supported.
- `dryRun` document commands publish nothing.

### Profile tests

- `profile.update` publishes a profile blob.
- Managed signing identity rename updates metadata label.
- `dryRun` profile update publishes nothing.

### Comment tests

- `comment.create` publishes expected comment blob(s).
- Reply semantics match CLI.
- `comment.update` and `comment.delete` match CLI semantics.

### Capability tests

- Capability grant creates/publishes expected blob(s).
- Revoke behavior matches CLI or returns unsupported if absent.

### Contact tests

- Contact create/update/delete match CLI semantics.
- Local subscription side effects, if any, are not accidentally invoked from the Agents service unless explicitly
  intended.

## Open questions

- What are the exact CLI command names and flags for each write domain?
- Which markdown/frontmatter parser does the CLI currently use?
- Does CLI support block-to-markdown export for drafts, or only markdown-to-block conversion?
- Does profile alias exist in CLI/SDK today?
- What are the exact capability role names and revoke semantics?
- Are contacts pure published blobs or do CLI commands also mutate local subscription state?
- Should document `expectedVersion` be exposed if the CLI does not expose it?
- Should `server` overrides be accepted, or should Agents always use the configured HM server?
- Should `dryRun` be exposed for every command even if CLI does not have a dry-run flag?
- Should account deletion be blocked if any agent references the signing key?

## Recommended first implementation slice

The smallest useful end-to-end slice is:

1. Finish CLI audit for profiles, drafts, and documents.
2. Add `write` tool shell and signer resolution.
3. Implement shared markdown/frontmatter parsing if needed.
4. Implement server-side `draft.create`, `draft.get`, and `draft.publish`.
5. Implement `profile.update`.
6. Implement `document.create` and `document.update` using the same draft publish pipeline.

This proves the full architecture: CLI-parity structured input, selected signer resolution, markdown conversion,
server-side drafts, document changes, refs, and publishing through the TS SDK.
