---
name: Agent write tool CLI-parity plan
summary: This document plans a unified model-facing Seed write tool for Agents. The tool should expose the complete Seed write surface in a way that is easy for a…
---
<!-- id:iyEGJoWJ -->
> **STATUS (2026-08-13): the command set was built and still runs; the tool that wrapped it is gone.** <!-- id:yhnGB8ai -->

\> <!-- id:gv7EeU7j -->
  > This plan predates the five verbs. There is no tool named `write` taking a `{command, ...}` envelope. There is a <!-- id:JQ4riafa -->
  > **write verb**, `write {address, content?, options?}`, and the whole surface below lives under it: an `hm://` address <!-- id:oCgpw462 -->
  > plus `options.action` selects the operation. The short actions (`document`, `update`, `comment`, `move`, `redirect`, <!-- id:rSdYNwbC -->
  > `delete`, `fork`) are named directly; every dotted command this plan specified (`draft.create`, `profile.update`, <!-- id:n8FaXvfl -->
  > `capability.create`, `contact.*`, …) passes through to the same signed command handlers unchanged. So the semantics, <!-- id:mctQD1k0 -->
  > the draft storage model, the markdown/JSON conversion, and the dry-run rules below are still accurate — the input <!-- id:cI3efC6r -->
  > envelope is not. <!-- id:PaZUqVC_ -->

\> <!-- id:iHDAk2h1 -->
  > **What else changed:** the same verb also writes `~/memory/**` files, authors `~/tools/**` lambda documents, and <!-- id:nysLzVqX -->
  > writes `ipfs://` — hypermedia is one address family among several. Permission moved from `"write"` in <!-- id:jW4XmIxR -->
  > `AgentDefinition.tools` to the **publish grant** (`'publish'`, with the legacy write-group names mapped onto it), <!-- id:AslwrfnG -->
  > because verbs are always on and cannot be toggled; memory and tool writes are never gated by it. Signer selection <!-- id:dLbJ5ONo -->
  > through `AgentDefinition.signingKeys` is unchanged. <!-- id:RcCbd7Ka -->

\> <!-- id:HU7LpN3u -->
  > **Still open:** the follow-ups recorded in `write-tool-implementation-notes.md` (file:// link resolution, PDF input, <!-- id:N3lxnGQe -->
  > `document.create` force/existing-path behaviour, `--delete-blocks` parity) were never picked up. <!-- id:GpEZpGFc -->

This document plans a unified model-facing Seed write tool for Agents. The tool should expose the complete Seed write surface in a way that is easy for a model to call while staying as close as possible to the Seed CLI command model. <!-- id:p1UN98Yk -->

The core idea is one tool: <!-- id:B1b17bfE -->

```ts <!-- id:V5gCb4zT -->
write(input)
```

The tool must be implemented with the same TypeScript SDK/shared code paths used by the CLI and desktop where possible. It must not shell out to `seed-cli`, `npx`, or any other command-line process. <!-- id:iqOw_DSr -->

# Goals <!-- id:Qc2XvOS- -->

- Provide one model-facing tool for all Seed writes. <!-- id:afKIsGxn -->
- Keep command names, option names, value shapes, and behavior as close to the CLI as possible. <!-- id:CbJxchxv -->
- Support the complete write surface: <!-- id:tzdK9yjz -->
  - documents, including document changes and refs; <!-- id:AM0K5D-I -->
  - document drafts; <!-- id:mnyrIjxz -->
  - markdown/frontmatter conversion; <!-- id:R2nPXbCM -->
  - JSON block input; <!-- id:qyO2Nyzs -->
  - comments; <!-- id:Se1XNlO4 -->
  - capabilities; <!-- id:CoA54P9t -->
  - contacts; <!-- id:PDldKflX -->
  - profiles. <!-- id:UJw5Weg0 -->
- Use agent-selected server-side HM account keys for signing. <!-- id:lTb5vvHW -->
- Let users refer to signing identities by profile name while the implementation signs with the public key account ID. <!-- id:Qssk4v21 -->
- Keep writes auditable through durable session tool events. <!-- id:KZs9D4Wo -->
- Support `dryRun` where practical so agents can stage or preview write operations before publishing. <!-- id:JNHTg7Lm -->

# Non-goals <!-- id:P8DaTDdi -->

- Do not invoke the CLI through `child_process`, `bun`, `npx`, temp files, or shell commands. <!-- id:Ug6LA4eE -->
- Do not use desktop-local keyrings or local CLI accounts. <!-- id:fe_KqG5e -->
- Do not let a tool call use every account key owned by the user. The tool may only use keys selected on the agent. <!-- id:mRO5UlYz -->
- Do not invent new protocol semantics when the CLI or TS SDK already has a meaning for an operation. <!-- id:MJYKxCwf -->
- Do not expose low-level internals like `publish_blobs` as separate model-facing tools unless future product direction explicitly calls for that. <!-- id:8H3rHaxx -->

# Guiding principle: structured CLI parity <!-- id:0RZ8Y81X -->

The model-facing API should be a structured form of CLI commands. Instead of exposing many tiny tools, the single tool routes by a CLI-like command name: <!-- id:j1BZXzXm -->

```ts <!-- id:fo5BOt_V -->
type WriteHypermediaInput = {
  command: WriteCommand
  signer?: SignerSelector
  server?: string
  dev?: boolean
  dryRun?: boolean
  input?: Record<string, unknown>
}
```

Example: <!-- id:TgzUxnvp -->

```ts <!-- id:XLBnVtLt -->
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

Where possible, field names inside `input` should mirror CLI option names. If the CLI uses `--location`, the tool should prefer `location` over a new synonym like `parent`. If the CLI uses `--edit`, the tool should prefer `edit` over `document`. <!-- id:DIVNAm0p -->

# Required CLI audit before implementation <!-- id:9uOya8D7 -->

Before implementation, inspect the CLI and shared packages to create an exact command map. The current expected source locations are: <!-- id:JzvlhZPd -->
  - `frontend/apps/cli/src/**` <!-- id:0Dy1sk1g -->
  - `frontend/packages/client/src/**` <!-- id:k-Muunn4 -->
  - `frontend/packages/shared/src/**` <!-- id:dCxozboX -->
  - `frontend/packages/editor/src/**` <!-- id:LcyfKBCp -->

The audit must cover: <!-- id:Y13oCzBE -->
  - document create/update/publish behavior; <!-- id:WROqbeKK -->
  - document refs and redirects; <!-- id:qlZTZJow -->
  - draft create/update/get/list/delete/publish behavior; <!-- id:y_675pSF -->
  - markdown/frontmatter parsing; <!-- id:Mc6h-1ro -->
  - JSON block parsing; <!-- id:tLj6ahBb -->
  - comment create/update/delete behavior; <!-- id:jC8vox5g -->
  - capability create/grant/revoke behavior; <!-- id:YrKzTKyA -->
  - contact create/update/delete or follow/unfollow behavior; <!-- id:wcswyjgt -->
  - profile update/alias behavior; <!-- id:ulj9z5lW -->
  - publish APIs used by each command; <!-- id:zl_OzGmI -->
  - output shape and error behavior. <!-- id:tTpVSlW4 -->

The audit should populate this table with exact command names and helpers: <!-- id:0cNCDkpS -->

<!-- id:Kh_MCk37 -->
| CLI command <!-- col:iSa_j6DB --> | Tool command <!-- col:Dm1B2WyW --> | CLI flags/options <!-- col:bXqB11Eq --> | Existing TS helper <!-- col:RCJg_1-j --> | Extraction needed <!-- col:nbfjm9bz --> | Notes <!-- col:S62AGZgW --> <!-- id:zsuTG8_U --> |
| --- | --- | --- | --- | --- | --- |
| `seed document create ...` | `document.create` | TBD | TBD | TBD | Must publish changes and refs. <!-- id:e2-pO2MF --> |
| `seed document update ...` | `document.update` | TBD | TBD | TBD | Must support markdown conversion. <!-- id:1ezQB0Rn --> |
| `seed document ref ...` | `document.ref` | TBD | TBD | TBD | Exact ref fields must match SDK/CLI. <!-- id:lNxk6mRT --> |
| `seed document redirect ...` | `document.redirect` | TBD | TBD | TBD | Include only if CLI supports it. <!-- id:YRihXrCL --> |
| `seed draft create ...` | `draft.create` | TBD | TBD | TBD | Server-side agent draft storage. <!-- id:LkBMMwlZ --> |
| `seed draft update ...` | `draft.update` | TBD | TBD | TBD | Preserve unspecified draft fields. <!-- id:r5LChYu6 --> |
| `seed draft get ...` | `draft.get` | TBD | TBD | TBD | Size-limited output. <!-- id:sDknlqUi --> |
| `seed draft list ...` | `draft.list` | TBD | TBD | TBD | Account-scoped listing. <!-- id:l1l3u70o --> |
| `seed draft delete ...` | `draft.delete` | TBD | TBD | TBD | Keep audit/status decision open. <!-- id:jHFxzelS --> |
| `seed draft publish ...` | `draft.publish` | TBD | TBD | TBD | Publishes changes and refs. <!-- id:nI6mo7mz --> |
| `seed comment create ...` | `comment.create` | TBD | TBD | TBD | Replies may be a flag or command. <!-- id:z2lxlt7h --> |
| `seed comment update ...` | `comment.update` | TBD | TBD | TBD | Match comment edit semantics. <!-- id:HSHnw8fi --> |
| `seed comment delete ...` | `comment.delete` | TBD | TBD | TBD | Match tombstone/delete semantics. <!-- id:wdZUBjkQ --> |
| `seed capability ...` | `capability.*` | TBD | TBD | TBD | Do not invent revoke if unsupported. <!-- id:0Y1PVbg2 --> |
| `seed contact ...` | `contact.*` | TBD | TBD | TBD | Clarify contact vs follow terminology. <!-- id:8tcbjB62 --> |
| `seed profile update ...` | `profile.update` | TBD | `createProfile` likely | TBD | Reuse server-side profile publishing helper. <!-- id:cPVMYAAw --> |
| `seed profile alias ...` | `profile.alias` | TBD | TBD | TBD | Include only if CLI/SDK supports it. <!-- id:IN8TbrdD --> |

# Signer selection and identity context <!-- id:ldGorz11 -->

Agents already allow each agent definition to select multiple server-side HM account keys: <!-- id:EWjLirIZ -->

```ts <!-- id:g9jRNrWH -->
type AgentDefinition = {
  tools?: string[]
  signingKey?: string // legacy single-key field
  signingKeys?: string[]
}
```

The write tool may only use identities selected in `signingKeys`, falling back to legacy `signingKey` for old agents. <!-- id:cEHVSFP5 -->

Model-facing signer selector: <!-- id:sh75YvIj -->

```ts <!-- id:IE6Jg3IW -->
type SignerSelector = {profileName: string} | {publicKey: string}
```

Resolution rules: <!-- id:VP6blaIX -->
  1. If `publicKey` is supplied, it must match the public key/account ID of one selected signing identity. <!-- id:lh2nn6bO -->
  2. If `profileName` is supplied, it must exactly match one selected identity label. <!-- id:MjMZWLB- -->
  3. If no signer is supplied and exactly one identity is selected, use that identity. <!-- id:RdxwL7xT -->
  4. If no signer is supplied and multiple identities are selected, return a structured error asking for a signer. <!-- id:VWAHRWFN -->
  5. If a profile name matches more than one selected identity, return a structured ambiguity error and list matching public keys. <!-- id:-Ee9wZwb -->
  6. Never resolve a signer outside the selected signing identities. <!-- id:-Nm4jwxb -->
  7. Never return or log private key material. <!-- id:seXhnssh -->

When write tools are enabled, append selected identities to the agent system prompt: <!-- id:p5oUiGMW -->

```xml <!-- id:umqFu5SN -->
<available_signing_identities>
[
  {
    "profileName": "Docs Bot",
    "publicKey": "z6Mk..."
  }
]
</available_signing_identities>
```

Prompt guidance should say: <!-- id:q6ifdnU_ -->
  > Use `write` for Seed write operations. Users may refer to signing identities by profile name. Signing uses the public <!-- id:FcQy7_lI -->
  > key account ID. If a requested identity is ambiguous, ask for clarification or use the public key. <!-- id:k0KyQg6B -->

# Tool registration and permissions <!-- id:Sa1MIiRz -->

Supported Seed tool names should include: <!-- id:t-cdvhj1 -->

```ts <!-- id:S-vZIIEi -->
'read'
'write'
```

Permission behavior: <!-- id:SC-MuURI -->
  - Legacy agents with `tools` omitted keep the old default: `read` only. <!-- id:3eDRBqp8 -->
  - `write` is never enabled by default. <!-- id:kHgzp_8L -->
  - The desktop Tools tab should expose a separate toggle for `write`. <!-- id:gsFieNJu -->
  - The write tool should be callable only when the agent definition includes `write`. <!-- id:F7WA2gRH -->
  - Even when enabled, write operations requiring signatures should fail clearly if no signing identities are selected. <!-- id:HG2VtSu5 -->

# Proposed command set <!-- id:_rdFf85s -->

Exact names should be finalized after the CLI audit. The initial target set is: <!-- id:f6oJkYvV -->

```ts <!-- id:ftwrJPSr -->
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

If the CLI uses materially different words, prefer the CLI names unless they are too ambiguous for model use. In that case, document the intentional mismatch in the command map. <!-- id:cIcke5YG -->

# Common input envelope <!-- id:zdguVK2n -->

Every write command should use the same outer envelope: <!-- id:X6ldIgO9 -->

```ts <!-- id:USdr_QS4 -->
type WriteHypermediaInput = {
  command: WriteCommand
  signer?: SignerSelector
  server?: string
  dev?: boolean
  dryRun?: boolean
  input?: Record<string, unknown>
}
```

Field meanings: <!-- id:TyO4ArBR -->
  - `command`: CLI-like command name. <!-- id:xGQSAZNr -->
  - `signer`: selected profile name or public key. <!-- id:zd7jyY_e -->
  - `server`: optional publish/resolve server override if CLI supports this. Otherwise omit or reject. <!-- id:TqDe2-0r -->
  - `dev`: optional dev server flag if CLI supports this. <!-- id:I0-gFEML -->
  - `dryRun`: validate and prepare the write without publishing blobs or mutating server state. <!-- id:7PTm0kQC -->
  - `input`: command-specific options, named to match CLI flags. <!-- id:qZUg7cVp -->

# Common output envelope <!-- id:DuB3TQxl -->

The tool should return structured output instead of CLI prose: <!-- id:F3TySdf- -->

```ts <!-- id:dEomI9f3 -->
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

Expected domain errors should return structured errors when possible: <!-- id:REayCuAD -->

```ts <!-- id:rnwrxWkN -->
type WriteHypermediaError = {
  type: 'hypermedia_write_error'
  command?: WriteCommand
  message: string
  details?: Record<string, unknown>
}
```

Unexpected implementation failures can still surface as tool execution errors, but common user/model errors should be machine-readable. <!-- id:HUVJ5Wsw -->

# Markdown and document content conversion <!-- id:5rXEwHZS -->

Document writes and drafts must support CLI-equivalent markdown conversion. <!-- id:hAmDtx0p -->

Supported content formats: <!-- id:Yr5J-S6j -->

```ts <!-- id:iZDhUOYh -->
type DocumentContentFormat = 'markdown' | 'json'
```

Possible future formats, only if the CLI path is safely extractable: <!-- id:vFUygJpe -->

```ts <!-- id:9IopdAtN -->
type FutureDocumentContentFormat = 'pdf'
```

## Markdown input <!-- id:07bpLjnT -->

Example: <!-- id:L_XFQUG_ -->

```ts <!-- id:McKwGK1U -->
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

Markdown conversion must support the same frontmatter fields as the CLI. The exact list must be confirmed in the CLI audit. Expected fields include: <!-- id:jMGgqAVg -->

```yaml <!-- id:_uZznF5n -->
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

The parser should produce: <!-- id:njk5k8R3 -->

```ts <!-- id:hFFtPUsK -->
type ParsedDocumentContent = {
  metadata: HMMetadata
  blocks: HMBlockNode[]
}
```

Open questions to answer during audit: <!-- id:Sqb1Zskh -->
  - Does frontmatter `name` override the first Markdown heading? <!-- id:be7BQtPV -->
  - If no frontmatter name exists, does the first heading become metadata name? <!-- id:3_BJ_ONO -->
  - Are unsupported frontmatter keys preserved, ignored, or rejected? <!-- id:s5EfgYIm -->
  - Are images uploaded/imported during markdown conversion, or are existing URLs required? <!-- id:Mr-XIAag -->
  - Does CLI normalize headings or block IDs in a specific way? <!-- id:e7dgQ_jx -->

## JSON block input <!-- id:eAnPGeH7 -->

The tool should also support JSON block input for CLI parity and advanced users: <!-- id:4s0VYPIp -->

```ts <!-- id:TXzfYLxk -->
{
  command: 'document.create',
  input: {
    content: [{type: 'Paragraph', text: 'Hello'}],
    format: 'json',
    metadata: {name: 'Hello'}
  }
}
```

It should accept either: <!-- id:Z4zukhrE -->
  - already-parsed JSON values; or <!-- id:LMzHESzr -->
  - a string containing JSON, if the CLI accepts JSON file content. <!-- id:QuL4OyOh -->

Validation must ensure the result is a valid HM document block tree. <!-- id:K1RWYnc5 -->

## Shared conversion module <!-- id:aE2JJ6EP -->

If markdown/frontmatter conversion currently lives inside CLI command handlers, extract it to a shared module used by both CLI and Agents. Preferred destination after audit: <!-- id:8YONStPL -->

```text <!-- id:GdO4V4k6 -->
frontend/packages/client/src/document-content.ts
```

Possible exports: <!-- id:Hxen8UqK -->

```ts <!-- id:K0cDmw8Q -->
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

Agents should depend on this shared module, not on CLI command files. <!-- id:r5Hwumbr -->

# Draft mode <!-- id:10Q08v9E -->

The write tool must support document draft workflows equivalent to the CLI draft model. <!-- id:rrMYBXSh -->

Important product decision: agent drafts should be server-side drafts owned by the Agents service, not desktop-local CLI or app draft files. <!-- id:Ei_0_i-b -->

Rationale: <!-- id:hTlKCdPD -->
  - Agents may run on a remote server. <!-- id:27Rw-7XB -->
  - The desktop draft directory is local to a user machine. <!-- id:GEeVv8V9 -->
  - Agent sessions need durable replay and continuity on the server. <!-- id:c7ESyDmX -->
  - Drafts created by an agent should be available to future agent runs against the same server. <!-- id:BIEkChD6 -->

This is semantic CLI parity, not storage parity. <!-- id:GmxBiP5M -->

## Draft storage <!-- id:ojBy5Ihd -->

Add an Agents service table similar to: <!-- id:OgTEmVqU -->

```sql <!-- id:Lq9q3R90 -->
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

Index recommendations: <!-- id:RgVV3xmC -->

```sql <!-- id:9g2pqbN_ -->
CREATE INDEX agent_drafts_account_updated_idx ON agent_drafts(account_id, updated_at DESC);
CREATE INDEX agent_drafts_agent_updated_idx ON agent_drafts(account_id, agent_id, updated_at DESC);
CREATE INDEX agent_drafts_status_idx ON agent_drafts(account_id, status);
```

`status` values: <!-- id:srQODa0V -->

```ts <!-- id:jG1zytS- -->
type DraftStatus = 'idle' | 'published' | 'deleted'
```

A hard delete can still be implemented, but retaining `published` and `deleted` statuses is useful for auditability and session continuity. <!-- id:pEyGEpJg -->

## `draft.create` <!-- id:q8FYnoTC -->

Tool input: <!-- id:6XNLi5BN -->

```ts <!-- id:ZCpwdEs8 -->
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

Behavior: <!-- id:jMN107bF -->
  - Parse markdown/frontmatter or JSON blocks. <!-- id:qrSIxx74 -->
  - Store parsed content and metadata in `agent_drafts`. <!-- id:pk86RqIq -->
  - Store routing metadata: <!-- id:2tW9bK09 -->
    - `edit` for updating an existing document; <!-- id:4AFlyuh8 -->
    - `location` for creating under a parent/location; <!-- id:RLP_FXlM -->
    - `path` or equivalent CLI field; <!-- id:aNnPO2LR -->
    - `visibility`. <!-- id:pB2CatJZ -->
  - Do not publish blobs. <!-- id:AX62-5Fp -->
  - If `signer` is supplied, store the selected signer secret name as the intended publishing account. <!-- id:VRlQJXtF -->
  - If `signer` is omitted, allow draft creation but require/resolve signer at publish time unless CLI semantics require a key earlier. <!-- id:dIXgoXEx -->

Output: <!-- id:GyR6C_OF -->

```ts <!-- id:h8bTUAmN -->
{
  type: 'hypermedia_write_result',
  command: 'draft.create',
  draftId: '...',
  message: 'Draft created'
}
```

## `draft.update` <!-- id:HOjAqC6S -->

Tool input: <!-- id:QJpZ6KwX -->

```ts <!-- id:3z3No196 -->
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

Behavior: <!-- id:CghJUd1v -->
  - Load an existing account-owned draft. <!-- id:8ly9bhGr -->
  - Modify content and/or routing metadata. <!-- id:Ir5D2GEv -->
  - Preserve unspecified fields. <!-- id:R_U0iI9G -->
  - Treat explicit `null` as clearing optional fields where CLI semantics allow clearing. <!-- id:TTvw91AU -->
  - Update `updated_at`. <!-- id:SbvY_VRX -->

## `draft.get` <!-- id:2sTwKkno -->

Tool input: <!-- id:wnEnzkSo -->

```ts <!-- id:dIpLp7qL -->
{
  command: 'draft.get',
  input: {
    draft: string
    format?: 'markdown' | 'json'
  }
}
```

Behavior: <!-- id:KegJpW9B -->
  - Return draft metadata and content. <!-- id:jyS_m0I0 -->
  - If `format: 'json'`, return blocks and metadata. <!-- id:neA4WgTT -->
  - If `format: 'markdown'`, return markdown only if there is a shared block-to-markdown converter matching CLI behavior. Otherwise return JSON and a warning. <!-- id:R7Mfd6X7 -->
  - Bound output size. Large drafts should return metadata plus a truncation warning. <!-- id:BrvZkYNz -->

## `draft.list` <!-- id:3t8t8P6g -->

Tool input: <!-- id:NuWFDTc1 -->

```ts <!-- id:BKC1M_0T -->
{
  command: 'draft.list',
  input?: {
    limit?: number
    status?: 'idle' | 'published' | 'deleted'
  }
}
```

Behavior: <!-- id:AWifC0EG -->
  - List account-owned drafts. <!-- id:8WyXvq8B -->
  - Prefer current agent drafts first if `agent_id` is stored. <!-- id:M1JQE1yB -->
  - Include title, status, routing fields, updated time, published target/version if present. <!-- id:MVdvvatt -->

## `draft.delete` <!-- id:Jzdpfi0h -->

Tool input: <!-- id:HreMm6Mk -->

```ts <!-- id:B-6dtBRh -->
{
  command: 'draft.delete',
  input: {
    draft: string
  }
}
```

Behavior: <!-- id:SA8OTt6c -->
  - Mark the draft deleted or hard-delete depending on final product choice. <!-- id:7ia1mPxA -->
  - Return a structured result. <!-- id:7cD0OQbu -->
  - Do not contact the HM server. <!-- id:j_37rFIg -->

## `draft.publish` <!-- id:gfxoZlWo -->

Tool input: <!-- id:X08UygzK -->

```ts <!-- id:7s-UZnvo -->
{
  command: 'draft.publish',
  signer?: SignerSelector,
  input: {
    draft: string
    expectedVersion?: string
  }
}
```

Behavior: <!-- id:hQdKQpbe -->
  - Load an account-owned draft. <!-- id:NtDl78PN -->
  - Resolve signer from request, stored intended signer, or selected identity defaults. <!-- id:xcyTZ8FU -->
  - Publish as: <!-- id:QsSefyD1 -->
    - update if `edit` is set; <!-- id:j6f4pCS0 -->
    - child/location create if `location` is set; <!-- id:-iRlFqXm -->
    - root document create otherwise. <!-- id:jUhKOBxM -->
  - Publish document changes and refs. <!-- id:KhVqLocN -->
  - Mark draft as published with `published_at`, `published_id`, and `published_version`. <!-- id:QVWGfWgT -->
  - Return canonical HM ID/URL/version. <!-- id:81D3lZfw -->

# Documents: changes and refs <!-- id:_qzfGvxh -->

Document commands must publish both document changes and refs where CLI semantics require both. <!-- id:k4ye6V7F -->

All direct document publish commands should use one internal helper also used by `draft.publish`: <!-- id:Uu4oSvge -->

```ts <!-- id:E5mqI9aZ -->
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

Responsibilities: <!-- id:XWLd57CE -->
  1. Resolve `edit` or `location` HM IDs. <!-- id:r_FMxYhq -->
  2. Determine whether the operation is a genesis/create, child create, or update. <!-- id:ETe_O68k -->
  3. Create the correct document change blobs. <!-- id:Xvyyp6-P -->
  4. Sign changes with the selected server-side HM key. <!-- id:LSNHZyPB -->
  5. Create or update refs as the CLI would. <!-- id:nmT2TDmX -->
  6. Publish all required blobs to the configured HM server. <!-- id:peNccdkc -->
  7. Return canonical ID, version, refs, and CIDs. <!-- id:sh0jUvrZ -->

## `document.create` <!-- id:SvTNUMAW -->

Tool input: <!-- id:P1evfv7j -->

```ts <!-- id:L44O7-wO -->
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

Behavior: <!-- id:8rdE8jn4 -->
  - Parse content. <!-- id:CgnxUG23 -->
  - If `location` is set, create under that location according to CLI semantics. <!-- id:v7Rg2ZiI -->
  - If `location` is omitted, create a root/top-level document according to CLI semantics. <!-- id:i5Lwxrpx -->
  - Publish changes and refs. <!-- id:jXl1SMHD -->

## `document.update` <!-- id:wOFDdnxz -->

Tool input: <!-- id:K_05KpGL -->

```ts <!-- id:sHCWpnh9 -->
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

Behavior: <!-- id:zynrdCS6 -->
  - Resolve the document named by `edit`. <!-- id:6LvZuAUU -->
  - If `expectedVersion` is supplied and current latest version differs, return a structured conflict error. <!-- id:PetUbBoi -->
  - Parse content. <!-- id:hIXPXvsP -->
  - Publish changes and refs. <!-- id:TArmTMfY -->

## `document.ref` <!-- id:5wgEiAok -->

Tool input must mirror the exact CLI/SDK ref structure. A provisional shape: <!-- id:PGLmJyss -->

```ts <!-- id:-SRVO1pW -->
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

Behavior: <!-- id:OanVQ5tH -->
  - Create a version ref exactly as the CLI does. <!-- id:tG-a3QAG -->
  - Publish the ref blob. <!-- id:ytgZWEHd -->
  - Return ref CID and target version. <!-- id:R0gUH4ZM -->

## `document.redirect` <!-- id:XSj9gvy9 -->

Include only if supported by CLI/SDK. Provisional shape: <!-- id:OG9QRbHy -->

```ts <!-- id:1P7QoWyv -->
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

Behavior: <!-- id:p6r_PPBW -->
  - Create a redirect ref exactly as the CLI does. <!-- id:MM2hIzvI -->
  - Publish the ref blob. <!-- id:fpWu6NiC -->

# Comments <!-- id:zUbXn2nP -->

Commands should mirror the CLI after audit. Initial expected commands: <!-- id:aFuo9RJ7 -->

```ts <!-- id:zP85taku -->
'comment.create'
'comment.update'
'comment.delete'
```

Potential reply support should follow CLI naming. If CLI uses `comment create --reply-to`, do not add a separate `comment.reply` command unless it materially improves model use. Prefer CLI parity. <!-- id:vH_ZiT_T -->

## `comment.create` <!-- id:Mh5LqKPh -->

Provisional input: <!-- id:7HV-ZZhe -->

```ts <!-- id:O3KdC5lU -->
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

## `comment.update` <!-- id:GDCOE3T9 -->

```ts <!-- id:xyXxtsMQ -->
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

## `comment.delete` <!-- id:1DmGqnmq -->

```ts <!-- id:2EXjdlI0 -->
{
  command: 'comment.delete',
  signer?: SignerSelector,
  input: {
    comment: string
  }
}
```

Implementation should use or extract shared helpers from the TS client/comment modules. It must preserve CLI semantics for comment IDs, replies, tombstones, and block targets. <!-- id:zx-7b_LT -->

# Capabilities <!-- id:NcYzRrQ2 -->

The write tool must support capability writes. Do not invent revoke/delete behavior if the CLI or protocol does not support it; the audit must determine exact semantics. <!-- id:783oRuHy -->

Initial expected commands: <!-- id:IS8upJox -->

```ts <!-- id:Vb2OrkXm -->
'capability.grant'
'capability.revoke'
```

Provisional grant input: <!-- id:9kIlgMMY -->

```ts <!-- id:ZFCKwMQC -->
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

Open questions: <!-- id:qKBDj99a -->
  - What role names does the CLI expose? <!-- id:oFb9crlm -->
  - Are capabilities path-scoped, document-scoped, or account-scoped in the CLI? <!-- id:rzZFNGNC -->
  - Is revoke implemented as a new blob, a tombstone, a ref, or not supported? <!-- id:ACXq-RMv -->
  - Are capabilities published to the same server with normal blob publishing? <!-- id:c72GXpFp -->

# Contacts <!-- id:Tny4xeLb -->

The write tool must support contact writes. Exact command names should match the CLI. The CLI may use words like `contact`, `follow`, or `unfollow`; choose parity after audit. <!-- id:sgfJDv4n -->

Initial expected commands: <!-- id:lRc59pca -->

```ts <!-- id:XzEymG1x -->
'contact.create'
'contact.update'
'contact.delete'
```

Provisional create/update input: <!-- id:WFdNtwfy -->

```ts <!-- id:WYt07Y2- -->
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

```ts <!-- id:TADlCU1c -->
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

```ts <!-- id:ayM_uqqY -->
{
  command: 'contact.delete',
  signer?: SignerSelector,
  input: {
    contact: string
  }
}
```

Open questions: <!-- id:ARRCVKIk -->
  - Does the CLI distinguish following an account from creating a contact blob? <!-- id:z5KCdZJM -->
  - Are local subscriptions involved, or only published contact blobs? <!-- id:3daatp3P -->
  - Does delete mean tombstone, replacement, or local removal? <!-- id:lFzi3ekW -->

# Profiles <!-- id:nFtVHgw0 -->

Profiles are both a standalone write domain and part of account management. <!-- id:zI7vFumy -->

Expected commands: <!-- id:2KgNwYX4 -->

```ts <!-- id:HRsT-hgN -->
'profile.update'
'profile.alias'
```

`profile.alias` should only be included if the CLI/SDK supports profile aliases. <!-- id:DSKkyWvT -->

## `profile.update` <!-- id:jLSL9IzO -->

Input: <!-- id:qjRctKu3 -->

```ts <!-- id:X3bkMeaK -->
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

Behavior: <!-- id:VQ_gspIR -->
  - Resolve signer. <!-- id:jZQ9EV2Z -->
  - Create a profile blob with the selected key. <!-- id:f8UWSeS6 -->
  - Publish it to the configured HM server. <!-- id:QDZmxcL9 -->
  - If the signer corresponds to a managed server-side key and `name` changes, update secret metadata label so the UI and future prompt context use the new profile name. <!-- id:Q5CP4v8B -->

## `profile.alias` <!-- id:3-xDguNb -->

Provisional input: <!-- id:1DPZYc2o -->

```ts <!-- id:CsNvIChe -->
{
  command: 'profile.alias',
  signer?: SignerSelector,
  input: {
    alias: string
  }
}
```

Finalize only after CLI audit. <!-- id:btKsMt8Z -->

# Dry-run semantics <!-- id:uEaAU5GN -->

`dryRun: true` should be supported for as many commands as possible. <!-- id:JCO1ZSue -->

Dry-run should: <!-- id:UA5JI-QH -->
  - validate input; <!-- id:foSBGNbG -->
  - resolve signer; <!-- id:P5o8TtZV -->
  - resolve targets where safe; <!-- id:z1Mdlz0Q -->
  - parse markdown/frontmatter; <!-- id:1MHml_7W -->
  - prepare blobs or preview data; <!-- id:qolYuyYD -->
  - return planned CIDs/targets/warnings where possible; <!-- id:lY5nd6_k -->
  - not call the HM server publish endpoint; <!-- id:NiFjEVD7 -->
  - not mutate local draft state except for explicitly local draft commands where dry-run means preview only. <!-- id:dLdgp7fL -->

For draft commands: <!-- id:zhHRFoDB -->
  - `draft.create` with `dryRun` should parse and validate but not insert a row. <!-- id:H5pZ-j5O -->
  - `draft.update` with `dryRun` should preview changed fields but not update the row. <!-- id:4C_VDqBt -->
  - `draft.delete` with `dryRun` should confirm that the draft exists but not delete it. <!-- id:oBTK3Kw5 -->
  - `draft.publish` with `dryRun` should prepare publish data but not publish or mark the draft published. <!-- id:yV2lINCX -->

If a command cannot faithfully dry-run in v1, it should return a structured error or warning rather than pretending. <!-- id:VzwAG-1- -->

# Validation and limits <!-- id:Pj8261SV -->

All tool input is an external boundary and must be validated there. <!-- id:9Zryu9wf -->

Recommended limits: <!-- id:tkdAqhai -->
  - command string: known command only; <!-- id:i7dII46j -->
  - signer profile/public key: bounded string length; <!-- id:_Ulj4nW4 -->
  - markdown content: bounded, e.g. 256 KiB initially; <!-- id:jHbu7LEj -->
  - JSON blocks: bounded by JSON size and normalized block count; <!-- id:mB-Ab0NN -->
  - metadata: bounded by encoded byte size; <!-- id:g2a3RrVF -->
  - draft list limit: bounded, e.g. max 100; <!-- id:ahCWNxOt -->
  - path/name: bounded and validated according to CLI rules; <!-- id:Zc-AHTWL -->
  - server URL: only HTTP/HTTPS if overrides are allowed. <!-- id:mgcyhkgE -->

Avoid repeating defensive normalization in deep helper functions. Normalize at the tool boundary, then pass typed values internally. <!-- id:pMB2E2zQ -->

# Internal architecture <!-- id:9nhXPCwK -->

Add a dedicated implementation module to keep `api-service.ts` from becoming too large: <!-- id:GKQizxzf -->

```text <!-- id:3Y3sGFW2 -->
agents/src/write-tool.ts
```

Possible exports: <!-- id:YZoOMBrL -->

```ts <!-- id:0TUcdwcw -->
export type WriteToolContext = {
  db: Database
  accountId: string
  agentId: string
  definition: api.AgentDefinition
  hmServerUrl: string
}

export function createWriteHypermediaPiTool(context: WriteToolContext): PiToolDefinition
```

If implementation becomes too large, split by domain only when it improves ownership: <!-- id:M1vkZAz2 -->

```text <!-- id:i_8sYgSB -->
agents/src/write-tool.ts
agents/src/write-tool-documents.ts
agents/src/write-tool-identity.ts
```

Start minimal and avoid many tiny modules. <!-- id:A6IYnusT -->

Core flow: <!-- id:5A4qApxQ -->

```ts <!-- id:riUmiGPA -->
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

# Shared signing helpers <!-- id:bzG5Nqda -->

Create shared server-side helpers for agent signing identities. These can live near the write tool or in `api-service.ts` until they need reuse. <!-- id:evM75B0y -->

Suggested types: <!-- id:_4V6N1NN -->

```ts <!-- id:DxANGklo -->
type AgentSigningIdentityMetadata = {
  secretName: string
  profileName: string
  publicKey: string
}

type ResolvedAgentSigner = AgentSigningIdentityMetadata & {
  keyPair: NobleKeyPair
}
```

Suggested functions: <!-- id:ohGt7Tur -->

```ts <!-- id:FiDYDjHM -->
listAgentSigningIdentityMetadata(db, accountId, allowedSecretNames): AgentSigningIdentityMetadata[]
resolveWriteSigner(db, accountId, allowedSecretNames, selector): ResolvedAgentSigner
loadSigningIdentityKeyPair(db, accountId, secretName): NobleKeyPair
```

These helpers should: <!-- id:K3_yZlJZ -->
  - filter by account ID; <!-- id:ch16Ek7- -->
  - filter by selected secret names; <!-- id:PhGNaSYp -->
  - verify `metadata.kind === 'hm-account-key'`; <!-- id:eTchD6WK -->
  - use metadata `accountId` as public key; <!-- id:PtoGxmel -->
  - use metadata `label` as profile name; <!-- id:dQXx-xz- -->
  - decrypt the seed only after the signer is resolved; <!-- id:HBN10mOA -->
  - never return raw seed values. <!-- id:QkJDA3pN -->

# Publish client <!-- id:iYzb-L37 -->

Use the TypeScript SDK/shared client: <!-- id:GLIcLRHa -->

```ts <!-- id:UBWGFjhl -->
createSeedClient(hmServerUrl)
```

Use shared blob/document/comment/capability/contact/profile helpers from the packages used by CLI. If CLI-only logic is needed, extract it to a shared package first. <!-- id:C5wbCd2L -->

The Agents service should not depend on CLI command handlers directly. <!-- id:yxhi3La1 -->

# UI changes <!-- id:75FzS37r -->

The Tools tab should expose: <!-- id:icb-H-b9 -->
  - `read` toggle; <!-- id:SxFXb_n8 -->
  - `write` toggle; <!-- id:oroJ8jJ4 -->
  - multi-select signing identities; <!-- id:XNF7sH_K -->
  - profile names and public keys for each identity; <!-- id:9hEFuE9R -->
  - inline new-account panel. <!-- id:1n_z1nJP -->

When `write` is enabled without selected signing identities, the UI should show a warning. The server should still enforce this at runtime. <!-- id:NfG6ZrbX -->

Manage accounts should continue supporting: <!-- id:4vCEG64p -->
  - create server-side HM account key; <!-- id:LTdICOLQ -->
  - publish profile blob on create; <!-- id:2zDIeOAC -->
  - rename/publish profile blob; <!-- id:4hsZzns4 -->
  - delete key. <!-- id:I4F7ybiX -->

Recommended safety improvement: block deleting a signing identity if any agent still references it in `signingKeys`, or remove it from affected agents in the same transaction. Blocking is safer for v1. <!-- id:VqFNNSeE -->

# Tool result rendering <!-- id:gTjk1E5f -->

Initial fallback JSON rendering is acceptable, but write results should receive first-class rendering soon because users need trust and visibility around writes. <!-- id:RjXFKdYN -->

Render fields: <!-- id:A1pPyrQe -->
  - command; <!-- id:l1Wel5ga -->
  - signer profile name; <!-- id:6BevX2jU -->
  - signer public key; <!-- id:9B0yZYOi -->
  - dry-run status; <!-- id:g5_JzuG9 -->
  - draft ID; <!-- id:Bf49RBEL -->
  - document ID/version/URL; <!-- id:taMBa6m6 -->
  - comment/capability/contact/profile IDs; <!-- id:xM2G4Oqz -->
  - published CIDs; <!-- id:iPK0wq60 -->
  - warnings/errors. <!-- id:2BzdehMH -->

# Auditability <!-- id:nSy5VqK2 -->

For v1, durable session events are the audit log: <!-- id:Et_cSsYL -->
  - tool call input; <!-- id:ArdFW6qj -->
  - tool result output; <!-- id:v2946V5G -->
  - errors. <!-- id:QM0y0oEX -->

Longer-term, consider a dedicated table: <!-- id:SMVBLgv1 -->

```sql <!-- id:_6doJv5P -->
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

A dedicated audit table is not required for initial implementation if durable session events are reliable and easy to inspect. <!-- id:0ju9iyj8 -->

# Implementation phases <!-- id:i-GuJiEa -->

## Phase 0: CLI audit <!-- id:L6nHezTc -->

- Read CLI command implementations for all write domains. <!-- id:zCbEGS8t -->
- Fill in the command map table in this document. <!-- id:9AbEUPY6 -->
- Identify reusable TS SDK/shared helpers. <!-- id:Osg5F1TK -->
- Identify CLI-local logic that must be extracted. <!-- id:ll5ytx0J -->
- Confirm exact command names and field names. <!-- id:r_rQkisJ -->

## Phase 1: content conversion extraction <!-- id:q7E7FcdU -->

- Extract markdown/frontmatter and JSON block parsing into a shared module if needed. <!-- id:cywpRdMU -->
- Update CLI to use the shared module if it was previously command-local. <!-- id:oY8Ri7e6 -->
- Add unit tests for markdown/frontmatter conversion. <!-- id:0Soz_07Z -->

## Phase 2: tool shell and signer resolution <!-- id:D2gRM9_p -->

- Add `write` as a known Seed tool. <!-- id:H6N4lbnH -->
- Register the Pi tool when enabled on the agent. <!-- id:8TQFqExc -->
- Add signer resolution by profile name/public key. <!-- id:hku-s5dv -->
- Return structured errors for missing, ambiguous, or unselected signers. <!-- id:9Jsj6AbN -->
- Add tests for signer resolution and permission enforcement. <!-- id:i_FRJDPI -->

## Phase 3: server-side drafts <!-- id:dCxmHxFd -->

- Add `agent_drafts` persistence. <!-- id:7YmHBJNi -->
- Implement: <!-- id:F2_hyPIY -->
  - `draft.create` <!-- id:fjzj4ySi -->
  - `draft.update` <!-- id:oJOOlpq4 -->
  - `draft.get` <!-- id:-sp9MJXL -->
  - `draft.list` <!-- id:wATvR9yR -->
  - `draft.delete` <!-- id:n7rgccZE -->
- Support `dryRun` for draft commands. <!-- id:F84Eb7lJ -->
- Add account-scoping tests. <!-- id:VLsmXHaf -->

## Phase 4: profiles <!-- id:tz-obea4 -->

- Refactor existing profile publishing helper for reuse. <!-- id:ATtm9A0X -->
- Implement `profile.update`. <!-- id:drp0j7js -->
- Implement `profile.alias` only if CLI/SDK supports it. <!-- id:1IgAJQ0- -->
- Ensure profile name changes update managed signing identity metadata. <!-- id:dB53pcKx -->

## Phase 5: documents and draft publish <!-- id:HtAbRVnA -->

- Implement shared `publishDocumentFromParsedContent`. <!-- id:nh5gciVw -->
- Implement: <!-- id:RUy2uHty -->
  - `document.create` <!-- id:5AsyVlY8 -->
  - `document.update` <!-- id:lpjorDTZ -->
  - `document.ref` <!-- id:QXM7tlse -->
  - `document.redirect` if supported <!-- id:_w-cTxeQ -->
  - `draft.publish` <!-- id:dFOTXGYG -->
- Ensure document create/update publishes both changes and refs. <!-- id:psoS0RSj -->
- Support markdown and JSON input. <!-- id:5f05R-5G -->
- Support conflict detection via `expectedVersion` if CLI/SDK semantics allow it. <!-- id:8_Jc12lW -->

## Phase 6: comments <!-- id:Z-C4V0t0 -->

- Implement comment create/update/delete using shared SDK helpers. <!-- id:wvgU8xrm -->
- Preserve reply semantics according to CLI. <!-- id:Mh-9SZCt -->
- Support CLI-equivalent content parsing for comments. <!-- id:VrbxYntZ -->

## Phase 7: capabilities and contacts <!-- id:VSxNxyGc -->

- Implement capability commands exactly as supported by CLI/SDK. <!-- id:KUAeoQZe -->
- Implement contact commands exactly as supported by CLI/SDK. <!-- id:K6iM9S4P -->
- Document any unsupported revoke/delete semantics instead of inventing behavior. <!-- id:sra7DbIA -->

## Phase 8: UI rendering and safety hardening <!-- id:0kZTOqpv -->

- Add rich write tool result rendering. <!-- id:toro7oBJ -->
- Add warnings in Tools tab for write tool without selected signers. <!-- id:vhiE6UT6 -->
- Add deletion guard for signing identities used by agents. <!-- id:Tzrrp5rU -->
- Consider optional dry-run-first policy. <!-- id:f_imzkn0 -->
- Consider dedicated write audit table. <!-- id:ktOx1qQ9 -->

# Test plan <!-- id:gzqepxQL -->

## CLI parity tests <!-- id:q2R1wc0A -->

After the audit, write tests that verify equivalent inputs produce equivalent SDK calls or blobs for CLI and tool shared helpers where practical. <!-- id:XxdNUGvP -->

## Content conversion tests <!-- id:k8jSyykG -->

- Markdown heading becomes title if CLI does that. <!-- id:BKvuZp8a -->
- Frontmatter metadata is parsed correctly. <!-- id:2aWsE3mj -->
- Frontmatter overrides or merges according to CLI semantics. <!-- id:1-F8EODW -->
- JSON block input validates. <!-- id:mZLs0IrG -->
- Invalid JSON returns a clear error. <!-- id:oORfYItR -->
- Oversized content is rejected. <!-- id:QUm93uqy -->

## Signer tests <!-- id:pII9fMfa -->

- Single selected signer can be omitted. <!-- id:hoFfAFw3 -->
- Multiple selected signers require explicit signer. <!-- id:f_g0Bnve -->
- Signer by profile name works. <!-- id:BkzGsP9j -->
- Signer by public key works. <!-- id:1ch0TUK5 -->
- Ambiguous profile name returns structured error. <!-- id:t_fpGWG4 -->
- Unselected public key is rejected. <!-- id:iK_QWhmI -->
- Missing/deleted secret is rejected. <!-- id:sdhMj4Si -->

## Draft tests <!-- id:K2vbaszH -->

- `draft.create` stores parsed markdown and metadata. <!-- id:BOI3wPh1 -->
- `draft.update` preserves unspecified fields. <!-- id:KSv2y4ix -->
- `draft.get` returns bounded content. <!-- id:UlhCh4lq -->
- `draft.list` is account-scoped. <!-- id:J1q7vlnD -->
- `draft.delete` marks or removes the draft. <!-- id:_2pvgKPU -->
- `draft.publish` publishes changes and refs. <!-- id:77nGcied -->
- `dryRun` draft commands do not mutate state. <!-- id:d-YVBY9o -->

## Document tests <!-- id:2JLZW7EL -->

- `document.create` from markdown publishes changes and refs. <!-- id:SwvtUAZt -->
- `document.create` with `location` creates the correct child/location ref. <!-- id:7qUp43Cr -->
- `document.update` from markdown publishes changes and refs. <!-- id:kgFjcCCW -->
- `document.update` with stale `expectedVersion` returns conflict. <!-- id:tKG4xuMF -->
- `document.ref` publishes a ref blob. <!-- id:bOyhULDR -->
- `document.redirect` publishes redirect ref if supported. <!-- id:qSkGlPxw -->
- `dryRun` document commands publish nothing. <!-- id:JgsW0veb -->

## Profile tests <!-- id:2T-EpWBY -->

- `profile.update` publishes a profile blob. <!-- id:xwSp_5aU -->
- Managed signing identity rename updates metadata label. <!-- id:uRlTFlzD -->
- `dryRun` profile update publishes nothing. <!-- id:bmt0RS9q -->

## Comment tests <!-- id:E5XmpquE -->

- `comment.create` publishes expected comment blob(s). <!-- id:q6ayPi-E -->
- Reply semantics match CLI. <!-- id:bdHFig_q -->
- `comment.update` and `comment.delete` match CLI semantics. <!-- id:GMId_J6c -->

## Capability tests <!-- id:7bIEF2C8 -->

- Capability grant creates/publishes expected blob(s). <!-- id:WG6aJmIS -->
- Revoke behavior matches CLI or returns unsupported if absent. <!-- id:ZDmKMrxh -->

## Contact tests <!-- id:-GoZbjVO -->

- Contact create/update/delete match CLI semantics. <!-- id:rStcHz3S -->
- Local subscription side effects, if any, are not accidentally invoked from the Agents service unless explicitly intended. <!-- id:_N0ywdtJ -->

# Open questions <!-- id:w7Uy6UOG -->

- What are the exact CLI command names and flags for each write domain? <!-- id:Nnt5ak2n -->
- Which markdown/frontmatter parser does the CLI currently use? <!-- id:gD-xIqmM -->
- Does CLI support block-to-markdown export for drafts, or only markdown-to-block conversion? <!-- id:ECgzlIGy -->
- Does profile alias exist in CLI/SDK today? <!-- id:Kfnm8xUK -->
- What are the exact capability role names and revoke semantics? <!-- id:EpCPF7Fu -->
- Are contacts pure published blobs or do CLI commands also mutate local subscription state? <!-- id:2D9Y6uHd -->
- Should document `expectedVersion` be exposed if the CLI does not expose it? <!-- id:9T-4XOXs -->
- Should `server` overrides be accepted, or should Agents always use the configured HM server? <!-- id:N_jzmgiC -->
- Should `dryRun` be exposed for every command even if CLI does not have a dry-run flag? <!-- id:NSWeRh86 -->
- Should account deletion be blocked if any agent references the signing key? <!-- id:cQrK1_La -->

# Recommended first implementation slice <!-- id:NkeFetbf -->

The smallest useful end-to-end slice is: <!-- id:EYPhnWJL -->
  1. Finish CLI audit for profiles, drafts, and documents. <!-- id:58kyePqx -->
  2. Add `write` tool shell and signer resolution. <!-- id:7qc5BKdQ -->
  3. Implement shared markdown/frontmatter parsing if needed. <!-- id:LN009tEw -->
  4. Implement server-side `draft.create`, `draft.get`, and `draft.publish`. <!-- id:e83azl67 -->
  5. Implement `profile.update`. <!-- id:zUkpzV3B -->
  6. Implement `document.create` and `document.update` using the same draft publish pipeline. <!-- id:lhA836G1 -->

This proves the full architecture: CLI-parity structured input, selected signer resolution, markdown conversion, server-side drafts, document changes, refs, and publishing through the TS SDK. <!-- id:F5a5rM0Z -->
