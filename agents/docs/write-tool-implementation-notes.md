# `write` implementation notes

These notes describe the first implementation slice of the Agents `write` tool. They are intended to help the next
engineer understand what was built, how it maps to CLI behavior, where the code lives, and which gaps remain.

## High-level summary

Agents now have a single model-facing write tool:

```text
write
```

The tool is intended to be the structured, SDK-backed equivalent of Seed CLI write commands. It does **not** shell out
to the CLI. It uses TypeScript SDK/shared helpers from `@seed-hypermedia/client` and `@shm/shared/blobs`.

The implementation is intentionally permissioned in two layers:

1. The agent must have `write` in `AgentDefinition.tools`.
2. The operation must use one of the signing identities selected in `AgentDefinition.signingKeys`.

Selected identities are exposed to the model in the system prompt with both their profile name and public key. The tool
can resolve a signer by either profile name or public key.

## Main files changed

### Runtime/tool implementation

- `agents/src/api-service.ts`
  - Adds `WRITE_HYPERMEDIA_TOOL_NAME`.
  - Registers `createWriteHypermediaPiTool(...)` in the Pi agent session.
  - Allows `write` through the Seed tool allowlist when explicitly enabled.
  - Implements signer resolution for selected server-side HM account keys.
  - Implements the current `write` command router and command handlers.
  - Implements server-side draft command handlers.
  - Reuses SDK/shared helpers for document changes/refs, comments, capabilities, contacts, profiles, and markdown
    conversion.

### Draft persistence

- `agents/src/sqlite-schema.sql`

  - Adds the `agent_drafts` table and indexes.

- `agents/src/sqlite.ts`

  - Adds a migration for `agent_drafts`.

- `agents/src/sqlite.test.ts`
  - Updates migration tests to include `agent_drafts`.

### Tests

- `agents/src/api-service.test.ts`
  - Adds an integration-style test that runs a Pi/OpenAI mocked tool-call loop for `write`.
  - Verifies profile update, draft creation from markdown/frontmatter, capability creation, contact creation, and draft
    metadata persistence.

### Desktop UI

- `frontend/apps/desktop/src/pages/agents.tsx`
  - Adds a visible `write` tool toggle.
  - Updates Tools tab copy so selected keys are described as immediately usable for signing/publishing.

### Docs

- `agents/docs/write-tool-cli-parity-plan.md`

  - Detailed planning/design document for CLI parity and future work.

- `agents/docs/write-tool-implementation-notes.md`

  - This file.

- Existing docs updated to stop describing signing/publishing tools as purely future work.

## Tool registration behavior

The Pi session setup now registers both custom tools:

```ts
customTools: [
  createReadHypermediaPiTool(),
  createWriteHypermediaPiTool({...}),
]
```

The available tool list still preserves legacy defaults:

- If `definition.tools === undefined`, only `read` is enabled.
- If `definition.tools` is explicit, it is filtered to known Seed tools:
  - `read`
  - `write`

This means `write` is **not** automatically enabled for old agents.

## Tool input envelope

The implemented tool uses the planned structured command envelope:

```ts
type WriteHypermediaInput = {
  command: string
  signer?: {
    profileName?: string
    publicKey?: string
  }
  server?: string
  dev?: boolean
  dryRun?: boolean
  input?: Record<string, unknown>
}
```

Important security note: although the schema accepts `server` and `dev` for CLI-parity shape, the implementation
currently rejects them for writes:

```text
write publishes only to the configured agent HM server
```

This was deliberate. Allowing the model to choose arbitrary publish servers would let a prompt/tool call exfiltrate
signed records to an attacker-controlled endpoint. Read tools can still accept server overrides; write tools cannot in
this first implementation.

## Tool output envelope

Successful commands return structured details similar to:

```ts
{
  type: 'hypermedia_write_result',
  command: 'profile.update',
  signer: {
    profileName: 'Writer Bot',
    publicKey: 'z6Mk...'
  },
  message: 'profile.update completed',
  cids: ['...']
}
```

Expected domain conflicts/errors can return:

```ts
{
  type: 'hypermedia_write_error',
  command: 'document.update',
  message: 'Document version conflict',
  details: {...}
}
```

Unexpected failures still surface as tool errors through Pi and are persisted as `tool_result.error`.

## Signer resolution

The tool only resolves signers from the agent-selected signing identities:

```ts
definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
```

Resolution rules:

1. If `signer.publicKey` is supplied, it must match the `metadata.accountId` of a selected HM account key secret.
2. If `signer.profileName` is supplied, it must exactly match the `metadata.label` of a selected HM account key secret.
3. If no signer is supplied and exactly one identity is selected, that identity is used.
4. If no signer is supplied and multiple identities are selected, the tool errors and asks for an explicit signer.
5. If a profile name is ambiguous, the tool errors and asks for public key selection.
6. Secrets are decrypted only after a selected identity is resolved.

The server-side key is converted to the SDK `HMSigner` shape:

```ts
{
  getPublicKey: async () => keyPair.principal,
  sign: (data) => keyPair.sign(data),
}
```

Raw seed/private key material is never returned in API or tool output.

## Implemented commands

The first implementation supports these command names:

### Drafts

- `draft.create`
- `draft.update`
- `draft.get`
- `draft.list`
- `draft.delete`
- `draft.publish`

Drafts are server-side Agents drafts, not desktop/CLI local draft files.

### Documents

- `document.create`
- `document.update`
- `document.delete`
- `document.fork`
- `document.move`
- `document.redirect`
- `document.ref`

Document create/update publishes document changes and refs using SDK helpers.

### Comments

- `comment.create`
- `comment.update`
- `comment.delete`

### Capabilities

- `capability.create`
- `capability.grant`

`capability.grant` is accepted as an alias for `capability.create`.

### Contacts

- `contact.create`
- `contact.delete`

The CLI currently exposes contact create/delete/list. This tool implements write commands only, so list is intentionally
not included here.

### Profiles

- `profile.update`
- `profile.alias`

There is no current CLI profile write command, but profile blobs are a required write domain for Agents account
management and signer display names.

## Markdown/frontmatter and JSON block support

Document and draft commands support:

```ts
format: 'markdown' | 'json'
```

If `format` is omitted:

- string content beginning with `[` or `{` is treated as JSON;
- other string content is treated as markdown;
- non-string content is treated as JSON.

Markdown parsing uses shared SDK helpers:

- `parseMarkdown`
- `markdownBlockNodesToHMBlockNodes`
- `flattenToOperations`

JSON block input is validated using:

```ts
HMBlockNodeSchema
```

Metadata is merged from:

1. defaults, where supplied;
2. frontmatter/input metadata;
3. explicit command input fields.

Metadata size is bounded with `MAX_METADATA_CBOR_BYTES`.

## Draft storage model

The new table:

```sql
CREATE TABLE agent_drafts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    agent_id TEXT REFERENCES agents (id),
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
) WITHOUT ROWID;
```

Indexes:

```sql
CREATE INDEX agent_drafts_account_updated_idx ON agent_drafts (account_id, updated_at DESC);
CREATE INDEX agent_drafts_agent_updated_idx ON agent_drafts (account_id, agent_id, updated_at DESC);
CREATE INDEX agent_drafts_status_idx ON agent_drafts (account_id, status);
```

Draft access is scoped by both:

- `account_id`
- `agent_id`

This prevents one agent under the same account from reading/updating/deleting/publishing another agent’s draft if it
somehow learns the draft ID.

`draft.delete` is soft delete:

```text
status = 'deleted'
```

`draft.list` excludes deleted drafts.

## Document behavior

### `document.create`

The tool:

1. Parses content.
2. Merges metadata.
3. Builds a `SetAttributes` operation for metadata.
4. Builds content operations.
5. Creates a genesis change.
6. Creates a signed content change.
7. Creates a version ref.
8. Publishes all blobs with `client.publish(...)`.

Default path is derived from metadata name/title via a local slugifier.

### `document.update`

The tool:

1. Resolves the target ID with `resolveIdWithClient`.
2. Fetches current `Resource`.
3. Checks `expectedVersion` if provided.
4. Parses new content.
5. Uses block diff helpers:
   - `createBlocksMap`
   - `hmBlockNodeToBlockNode`
   - `computeReplaceOps`
6. Resolves document state with `resolveDocumentState`.
7. Creates a signed change.
8. Creates a version ref.
9. Publishes change/ref blobs.

Using `computeReplaceOps` matters because it can remove blocks missing from the replacement content. A naive full list
of `ReplaceBlock`/`MoveBlocks` operations can leave stale blocks behind.

### Refs, redirects, fork, move

- `document.ref` can either publish an explicit version ref or, when given `source` and `destination`, behave like a
  fork.
- `document.fork` is routed through the same source/destination ref path.
- `document.move` publishes a destination version ref and then a redirect from the source.
- `document.redirect` publishes a redirect ref.

Redirect now resolves capabilities for delegated write cases.

## Comments

Comment commands reuse SDK helpers:

- `createComment`
- `updateComment`
- `deleteComment`

Comment body markdown uses the same markdown parser and `markdownBlockNodesToHMBlockNodes` conversion. Empty comments
produce an empty paragraph so the published comment still has content shape.

`comment.create` resolves the document target, fetches the target document version, and publishes a comment against that
version.

Reply support is included through `reply`/`replyTo` fields.

## Capabilities

Capability writes use SDK helper:

```ts
createCapability({delegateUid, role, path, label}, signer)
```

Accepted roles are:

- `WRITER`
- `AGENT`

The tool normalizes role input to uppercase and rejects anything else.

## Contacts

Contact writes use SDK helpers:

- `createContact`
- `deleteContact`

`contact.create` currently follows the CLI-exposed shape:

```ts
{
  subject: string
  name: string
}
```

`contact.delete` requires a contact record ID. Unlike the CLI, this first implementation does not resolve a contact CID
through `/ipfs/<cid>` before deletion.

## Profiles

Profile writes use shared blob helpers from `@shm/shared/blobs`:

- `createProfile`
- `createProfileAlias`

`profile.update` publishes a profile blob. If the signer is a managed server-side HM account key, the secret metadata
label is also updated so the Tools tab and future system prompts show the new profile name.

`profile.alias` decodes the provided alias principal and publishes an alias profile blob.

## Desktop UI behavior

The Tools tab now includes:

```text
write — Write Seed content
```

The copy says selected account keys can be used to create, sign, and publish Seed content. The UI still autosaves tool
toggles and signing key selection.

`write` should be explicitly enabled by the user. It is not enabled by default for existing agents.

## Integration test details

The main integration test is in `agents/src/api-service.test.ts`:

```text
runs write profile and draft tool calls with selected signing identities
```

It mocks `globalThis.fetch` for both:

- OpenAI-compatible streaming tool-call responses;
- Seed `PublishBlobs` calls.

The model mock emits `write` tool calls for:

- `profile.update`
- `draft.create`
- `capability.create`
- `contact.create`

The test verifies:

- Pi/OpenAI payload exposes both `read` and `write` when configured.
- The prompt includes the selected signing identity profile name.
- Tool results are returned into the Pi message loop.
- Four publish calls occur:
  1. profile publish during signing identity creation;
  2. profile update from `write`;
  3. capability create;
  4. contact create.
- A draft row is stored.
- Markdown frontmatter metadata, including `summary`, is preserved in `metadata_cbor`.

## Validation run during implementation

The following validations passed after this implementation:

```bash
cd agents && bun check
cd agents && bun test
pnpm typecheck
git diff --check
```

## Subagent review feedback applied

A reviewer subagent flagged several issues. The critical ones were fixed:

### Arbitrary write server selection

Problem: accepting `server`/`dev` would allow the model to publish signed blobs to arbitrary endpoints.

Fix: `write` rejects `server` and `dev` for writes and always uses the configured agent HM server.

### Draft scoping

Problem: drafts were account-scoped only.

Fix: draft get/update/list/delete/publish access is now scoped by both account and agent.

Other fixes applied from review:

- `draft.list` excludes soft-deleted drafts.
- `document.update` uses block diffing instead of naive replacement ops.
- `document.redirect` resolves and passes capability for delegated writes.
- JSON block input validates with `HMBlockNodeSchema`.
- Metadata is size-limited.
- Tools tab copy was updated to reflect write tool availability.

## Known limitations and follow-ups

This is a broad first slice, but it is not the final polished write system.

### Document creation does not yet include file:// link resolution

The CLI resolves `file://` links in markdown/JSON blocks and metadata into IPFS blobs. The current tool does not resolve
local files. This is probably correct for server-side Agents until there is a clear file-upload story, but it is a
CLI-parity gap.

### PDF input is not implemented

The CLI can import PDFs through `pdfToBlocks`. The tool currently supports only markdown and JSON.

### `document.create` force/existing-path behavior is incomplete

The CLI checks existing document paths and requires `--force` to avoid accidental lineage replacement. This
implementation does not yet perform that exact guard.

### `document.update --delete-blocks` parity is not implemented

The tool uses replacement diffing for full-content updates, but it does not expose a separate `deleteBlocks` input like
CLI `--delete-blocks`.

### `document.update --parent` is not implemented

The CLI declares `--parent`, though the current CLI implementation may not use it meaningfully. The tool does not
implement parent insertion semantics.

### Draft publish ignores some stored routing fields

`draft.publish` currently distinguishes update vs create through `edit_target`; it does not fully implement all
`location_target`, `visibility`, and path semantics from CLI drafts.

### Contact update is not implemented

The SDK supports `updateContact`, but the CLI currently exposes create/delete/list. The initial tool implements
create/delete only.

### Capability revoke is not implemented

The CLI currently exposes capability create. Revoke semantics are not implemented here because they were not found in
the CLI audit.

### Contact delete by CID is not implemented

The CLI accepts either a contact record ID or CID and can resolve the CID through `/ipfs/<cid>`. The tool currently
expects a record ID.

### Rich UI rendering is not implemented

Tool results persist as structured events and fall back to JSON rendering. A future UI pass should render write results
with command, signer, IDs, versions, and CIDs.

### Dedicated audit table is not implemented

Durable session tool events are the current audit trail. A dedicated write audit table may be useful later.

### Write confirmation/dry-run-first policy is not implemented

The tool supports `dryRun` for many commands, but there is no user policy requiring dry run before publish.

## Suggested next implementation priorities

1. Improve `draft.publish` to fully honor CLI draft routing:
   - `edit`
   - `location`
   - `visibility`
   - `path`
2. Add document create existing-path/`force` guard.
3. Add document metadata/file-link handling strategy for server-side Agents.
4. Add direct tests for signer resolution edge cases:
   - omitted signer with one identity;
   - omitted signer with multiple identities;
   - ambiguous profile names;
   - unselected public key rejection.
5. Add direct tests for document create/update publishing with mocked Resource/ListChanges/PublishBlobs responses.
6. Add rich UI rendering for `write` results.
7. Consider splitting `write` implementation out of `api-service.ts` once the shape stabilizes.
