---
name: write implementation notes
summary: These notes describe the first implementation slice of the Agents write tool. They are intended to help the next engineer understand what was built, how it…
---
<!-- id:6ZpxBUcm -->
> **STATUS (2026-08-13): accurate as a record of the first slice; the envelope and the permission model have both** <!-- id:dUfJE3oB -->
> changed. <!-- id:mnuKSzVl -->

\> <!-- id:lAkYSy_b -->
  > The command implementations, draft storage, markdown/frontmatter conversion, and signer resolution described here are <!-- id:Vkz6djIC -->
  > still what runs. What moved: this tool is now the **write verb**, `write {address, content?, options?}` — an `hm://` <!-- id:426PEAVX -->
  > address with `options.action` where these notes say `command`, and the same verb also covers `~/memory/**`, <!-- id:3NwR-6qi -->
  > `~/tools/**` and `ipfs://`. The two-layer permission model in "High-level summary" is now one layer plus one: the <!-- id:dLC9SENj -->
  > **publish grant** (`'publish'` in `definition.tools`, legacy write-group names mapped onto it) replaces `"write"` in <!-- id:RYFhFuKX -->
  > the tools array, and `AgentDefinition.signingKeys` still selects the identity. Verbs themselves are always on and are <!-- id:KqfpSP-A -->
  > never grants. <!-- id:Ekqilbp8 -->

\> <!-- id:64vn5r8h -->
  > The "Known limitations and follow-ups" at the end are all still open. <!-- id:2B9TfZRL -->

These notes describe the first implementation slice of the Agents `write` tool. They are intended to help the next engineer understand what was built, how it maps to CLI behavior, where the code lives, and which gaps remain. <!-- id:RKNgGPbj -->

# High-level summary <!-- id:BzP1_Sr8 -->

Agents now have a single model-facing write tool: <!-- id:HGQwDc_6 -->

```text <!-- id:b0Fx2VzC -->
write
```

The tool is intended to be the structured, SDK-backed equivalent of Seed CLI write commands. It does **not** shell out to the CLI. It uses TypeScript SDK/shared helpers from `@seed-hypermedia/client` and `@shm/shared/blobs`. <!-- id:JuYndSXz -->

The implementation is intentionally permissioned in two layers: <!-- id:_wyZCdnQ -->
  1. The agent must have `write` in `AgentDefinition.tools`. <!-- id:I-TVkQga -->
  2. The operation must use one of the signing identities selected in `AgentDefinition.signingKeys`. <!-- id:7xuGSbYX -->

Selected identities are exposed to the model in the system prompt with both their profile name and public key. The tool can resolve a signer by either profile name or public key. <!-- id:T_W3b0w1 -->

# Main files changed <!-- id:4ODE7JdJ -->

## Runtime/tool implementation <!-- id:9keIrQmw -->

- `agents/src/api-service.ts` <!-- id:S7fg1WhH -->
  - Adds `WRITE_HYPERMEDIA_TOOL_NAME`. <!-- id:-vgdacgI -->
  - Registers `createWriteHypermediaPiTool(...)` in the Pi agent session. <!-- id:53PwnRn7 -->
  - Allows `write` through the Seed tool allowlist when explicitly enabled. <!-- id:oId1oe61 -->
  - Implements signer resolution for selected server-side HM account keys. <!-- id:zP208j9J -->
  - Implements the current `write` command router and command handlers. <!-- id:TWx8RdDU -->
  - Implements server-side draft command handlers. <!-- id:CQ1OxmlH -->
  - Reuses SDK/shared helpers for document changes/refs, comments, capabilities, contacts, profiles, and markdown conversion. <!-- id:5AWc9RHd -->

## Draft persistence <!-- id:VbosW-qT -->

- `agents/src/sqlite-schema.sql` <!-- id:NZ0SMGsT -->
  - Adds the `agent_drafts` table and indexes. <!-- id:ZxiBue2s -->
- `agents/src/sqlite.ts` <!-- id:DXJRAkWd -->
  - Adds a migration for `agent_drafts`. <!-- id:YeKj5d12 -->
- `agents/src/sqlite.test.ts` <!-- id:Q5Vm5gGh -->
  - Updates migration tests to include `agent_drafts`. <!-- id:mNdaa8M2 -->

## Tests <!-- id:4-0LJE_z -->

- `agents/src/api-service.test.ts` <!-- id:WWB1j4Yh -->
  - Adds an integration-style test that runs a Pi/OpenAI mocked tool-call loop for `write`. <!-- id:moV7ngEq -->
  - Verifies profile update, draft creation from markdown/frontmatter, capability creation, contact creation, and draft metadata persistence. <!-- id:fn8c6m_M -->

## Desktop UI <!-- id:W6D-VuHk -->

- `frontend/apps/desktop/src/pages/agents.tsx` <!-- id:x4DJRj0M -->
  - Adds a visible `write` tool toggle. <!-- id:yNPV8u4p -->
  - Updates Tools tab copy so selected keys are described as immediately usable for signing/publishing. <!-- id:UYabDkJB -->

## Docs <!-- id:nmaPur7H -->

- `agents/docs/write-tool-cli-parity-plan.md` <!-- id:6EnkpL5a -->
  - Detailed planning/design document for CLI parity and future work. <!-- id:PPx-UVYc -->
- `agents/docs/write-tool-implementation-notes.md` <!-- id:sYP7Jasl -->
  - This file. <!-- id:3Fwru87f -->
- Existing docs updated to stop describing signing/publishing tools as purely future work. <!-- id:dxLN5vAL -->

# Tool registration behavior <!-- id:4fUUb8_z -->

The Pi session setup now registers both custom tools: <!-- id:DLy_zyHQ -->

```ts <!-- id:JWk8oa8C -->
customTools: [
  createReadHypermediaPiTool(),
  createWriteHypermediaPiTool({...}),
]
```

The available tool list still preserves legacy defaults: <!-- id:GZUshGQf -->
  - If `definition.tools === undefined`, only `read` is enabled. <!-- id:0FRCMw5S -->
  - If `definition.tools` is explicit, it is filtered to known Seed tools: <!-- id:HBCu34ST -->
    - `read` <!-- id:WCERnD7M -->
    - `write` <!-- id:f_YSwULK -->

This means `write` is **not** automatically enabled for old agents. <!-- id:76pRFAs2 -->

# Tool input envelope <!-- id:qtHeBqBf -->

The implemented tool uses the planned structured command envelope: <!-- id:3BRwWzEM -->

```ts <!-- id:N4pzAHPy -->
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

Important security note: although the schema accepts `server` and `dev` for CLI-parity shape, the implementation currently rejects them for writes: <!-- id:Ii34k-OQ -->

```text <!-- id:isacGb4- -->
write publishes only to the configured agent HM server
```

This was deliberate. Allowing the model to choose arbitrary publish servers would let a prompt/tool call exfiltrate signed records to an attacker-controlled endpoint. Read tools can still accept server overrides; write tools cannot in this first implementation. <!-- id:ZyMSLVtd -->

# Tool output envelope <!-- id:rVPaJzEB -->

Successful commands return structured details similar to: <!-- id:aVgfnOJo -->

```ts <!-- id:3ArGPhG3 -->
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

Expected domain conflicts/errors can return: <!-- id:G6MZ9kq7 -->

```ts <!-- id:66DREAUF -->
{
  type: 'hypermedia_write_error',
  command: 'document.update',
  message: 'Document version conflict',
  details: {...}
}
```

Unexpected failures still surface as tool errors through Pi and are persisted as `tool_result.error`. <!-- id:ZASI7_D0 -->

# Signer resolution <!-- id:qMeBGLMf -->

The tool only resolves signers from the agent-selected signing identities: <!-- id:5ycyrdA5 -->

```ts <!-- id:K7vTpxZ3 -->
definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
```

Resolution rules: <!-- id:xt4Jt9nI -->
  1. If `signer.publicKey` is supplied, it must match the `metadata.accountId` of a selected HM account key secret. <!-- id:NAj-ttkT -->
  2. If `signer.profileName` is supplied, it must exactly match the `metadata.label` of a selected HM account key secret. <!-- id:YeuybNma -->
  3. If no signer is supplied and exactly one identity is selected, that identity is used. <!-- id:ko4Jc7j2 -->
  4. If no signer is supplied and multiple identities are selected, the tool errors and asks for an explicit signer. <!-- id:4BVyDkT4 -->
  5. If a profile name is ambiguous, the tool errors and asks for public key selection. <!-- id:nA4KYVRA -->
  6. Secrets are decrypted only after a selected identity is resolved. <!-- id:pB2JXtML -->

The server-side key is converted to the SDK `HMSigner` shape: <!-- id:EIpAzAWs -->

```ts <!-- id:Wq4tRkVD -->
{
  getPublicKey: async () => keyPair.principal,
  sign: (data) => keyPair.sign(data),
}
```

Raw seed/private key material is never returned in API or tool output. <!-- id:g4ymZpCA -->

# Implemented commands <!-- id:GaLyS0QQ -->

The first implementation supports these command names: <!-- id:fTqyVWYy -->

## Drafts <!-- id:9rw_rAVv -->

<!-- id:KkB4QqGG -->
- `draft.create` <!-- id:hPvgpeWI -->
- `draft.update` <!-- id:iz5AcpeG -->
- `draft.get` <!-- id:W2F-gB-h -->
- `draft.list` <!-- id:fiXv-pNG -->
- `draft.delete` <!-- id:JNid1Rn2 -->
- `draft.publish` <!-- id:8dE4jUCG -->

Drafts are server-side Agents drafts, not desktop/CLI local draft files. <!-- id:aZ4UQ13- -->

## Documents <!-- id:RpUY2N7I -->

<!-- id:OugqSXVm -->
- `document.create` <!-- id:O38cbvan -->
- `document.update` <!-- id:GFnZ24GB -->
- `document.delete` <!-- id:-a6NFIzS -->
- `document.fork` <!-- id:MSz7mwHp -->
- `document.move` <!-- id:LimYpYEa -->
- `document.redirect` <!-- id:r28G2A3A -->
- `document.ref` <!-- id:N7_hhu8J -->

Document create/update publishes document changes and refs using SDK helpers. <!-- id:p9P7SSdd -->

## Comments <!-- id:85q3VQCe -->

- `comment.create` <!-- id:viK9XAIG -->
- `comment.update` <!-- id:ArqUrpEE -->
- `comment.delete` <!-- id:3ZgE7KGe -->

## Capabilities <!-- id:UkFkZYUa -->

<!-- id:8tvzkuzb -->
- `capability.create` <!-- id:-M1h139G -->
- `capability.grant` <!-- id:wmI5lJL9 -->

`capability.grant` is accepted as an alias for `capability.create`. <!-- id:bdftGr_R -->

## Contacts <!-- id:H_5ngXH0 -->

<!-- id:xqnwvvVz -->
- `contact.create` <!-- id:EIR2tBEU -->
- `contact.delete` <!-- id:LQtvsZhi -->

The CLI currently exposes contact create/delete/list. This tool implements write commands only, so list is intentionally not included here. <!-- id:p7Y1Fqkw -->

## Profiles <!-- id:Z7r7tdBB -->

<!-- id:MqOiwXGq -->
- `profile.update` <!-- id:wH9kEmUY -->
- `profile.alias` <!-- id:TOaoEyB4 -->

There is no current CLI profile write command, but profile blobs are a required write domain for Agents account management and signer display names. <!-- id:3gaLQU9a -->

# Markdown/frontmatter and JSON block support <!-- id:YSZxIUSY -->

Document and draft commands support: <!-- id:9SFhq40h -->

```ts <!-- id:nMPwARt0 -->
format: 'markdown' | 'json'
```

If `format` is omitted: <!-- id:-0SSuHD4 -->
  - string content beginning with `[` or `{` is treated as JSON; <!-- id:fVehzRMl -->
  - other string content is treated as markdown; <!-- id:G63meSFo -->
  - non-string content is treated as JSON. <!-- id:Vurpehc5 -->

Markdown parsing uses shared SDK helpers: <!-- id:AzX6PMrG -->
  - `parseMarkdown` <!-- id:aq0d57vk -->
  - `markdownBlockNodesToHMBlockNodes` <!-- id:GGB9fvzE -->
  - `flattenToOperations` <!-- id:uS6Ptj7r -->

JSON block input is validated using: <!-- id:brHsjvvy -->

```ts <!-- id:fKEtsCQQ -->
HMBlockNodeSchema
```

Metadata is merged from: <!-- id:nQ8CJ_cM -->
  1. defaults, where supplied; <!-- id:XM_cQnt9 -->
  2. frontmatter/input metadata; <!-- id:NPBoJJkJ -->
  3. explicit command input fields. <!-- id:AVYca6gZ -->

Metadata size is bounded with `MAX_METADATA_CBOR_BYTES`. <!-- id:ROtD6C_J -->

# Draft storage model <!-- id:AUQmF_x7 -->

The new table: <!-- id:-hGnkD_O -->

```sql <!-- id:bZ4LmeIX -->
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

Indexes: <!-- id:sr7EHrBR -->

```sql <!-- id:piWp_Jt_ -->
CREATE INDEX agent_drafts_account_updated_idx ON agent_drafts (account_id, updated_at DESC);
CREATE INDEX agent_drafts_agent_updated_idx ON agent_drafts (account_id, agent_id, updated_at DESC);
CREATE INDEX agent_drafts_status_idx ON agent_drafts (account_id, status);
```

Draft access is scoped by both: <!-- id:1oFj_AD3 -->
  - `account_id` <!-- id:xnG0hcZw -->
  - `agent_id` <!-- id:bZTEcuqk -->

This prevents one agent under the same account from reading/updating/deleting/publishing another agent’s draft if it somehow learns the draft ID. <!-- id:wYKWsVaw -->

`draft.delete` is soft delete: <!-- id:jGRqoGbL -->

```text <!-- id:lvY3Qkxo -->
status = 'deleted'
```

`draft.list` excludes deleted drafts. <!-- id:Mqj_mJGG -->

# Document behavior <!-- id:NFUmI_SC -->

## `document.create` <!-- id:94iMj_xt -->

The tool: <!-- id:OfPgrudu -->
  1. Parses content. <!-- id:APdMSPVz -->
  2. Merges metadata. <!-- id:OkdjajOn -->
  3. Builds a `SetAttributes` operation for metadata. <!-- id:LMK-ZF_l -->
  4. Builds content operations. <!-- id:zI6Ok3n4 -->
  5. Creates a genesis change. <!-- id:C4MoAFqS -->
  6. Creates a signed content change. <!-- id:avsw38V7 -->
  7. Creates a version ref. <!-- id:k7GXhOtn -->
  8. Publishes all blobs with `client.publish(...)`. <!-- id:m13Qgbh2 -->

Default path is derived from metadata name/title via a local slugifier. <!-- id:_oHbsUw3 -->

## `document.update` <!-- id:nqH8h0u9 -->

The tool: <!-- id:M_RU6esU -->
  1. Resolves the target ID with `resolveIdWithClient`. <!-- id:LMZBpJGh -->
  2. Fetches current `Resource`. <!-- id:JUfMb38N -->
  3. Checks `expectedVersion` if provided. <!-- id:CJdqpIDI -->
  4. Parses new content. <!-- id:VG6UWITW -->
  5. Uses block diff helpers: <!-- id:f0Vh3IA6 -->
     - `createBlocksMap` <!-- id:njGJ_b5e -->
     - `hmBlockNodeToBlockNode` <!-- id:uqVLv_eq -->
     - `computeReplaceOps` <!-- id:kFrJPYss -->
  6. Resolves document state with `resolveDocumentState`. <!-- id:jlUs170b -->
  7. Creates a signed change. <!-- id:mvCTzram -->
  8. Creates a version ref. <!-- id:RyFL_ek_ -->
  9. Publishes change/ref blobs. <!-- id:wSP8Mhm4 -->

Using `computeReplaceOps` matters because it can remove blocks missing from the replacement content. A naive full list of `ReplaceBlock`/`MoveBlocks` operations can leave stale blocks behind. <!-- id:a-06FEmn -->

## Refs, redirects, fork, move <!-- id:Ff_Se9pD -->

<!-- id:wcW_7Acg -->
- `document.ref` can either publish an explicit version ref or, when given `source` and `destination`, behave like a fork. <!-- id:riaVL6_Q -->
- `document.fork` is routed through the same source/destination ref path. <!-- id:gFHTp8uG -->
- `document.move` publishes a destination version ref and then a redirect from the source. <!-- id:w4lootAN -->
- `document.redirect` publishes a redirect ref. <!-- id:kvsWxogh -->

Redirect now resolves capabilities for delegated write cases. <!-- id:TX2XOzAD -->

# Comments <!-- id:3Q_FYeTd -->

Comment commands reuse SDK helpers: <!-- id:Vk3ijQqO -->
  - `createComment` <!-- id:kDSLxsHd -->
  - `updateComment` <!-- id:sFt15AWk -->
  - `deleteComment` <!-- id:mA392pJP -->

Comment body markdown uses the same markdown parser and `markdownBlockNodesToHMBlockNodes` conversion. Empty comments produce an empty paragraph so the published comment still has content shape. <!-- id:rNgOgh-0 -->

`comment.create` resolves the document target, fetches the target document version, and publishes a comment against that version. <!-- id:MIYFI5Gi -->

Reply support is included through `reply`/`replyTo` fields. <!-- id:UVCXEMRS -->

# Capabilities <!-- id:eCdJIiD6 -->

Capability writes use SDK helper: <!-- id:-hcTByv4 -->

```ts <!-- id:WKgegrZ- -->
createCapability({delegateUid, role, path, label}, signer)
```

Accepted roles are: <!-- id:qXzPYWJ5 -->
  - `WRITER` <!-- id:6-cGdkWI -->
  - `AGENT` <!-- id:Sy3cCbVg -->

The tool normalizes role input to uppercase and rejects anything else. <!-- id:e_yFUM-- -->

# Contacts <!-- id:zcQilN7L -->

Contact writes use SDK helpers: <!-- id:JzWbE4DY -->
  - `createContact` <!-- id:F7HF03ts -->
  - `deleteContact` <!-- id:DgZ5uurj -->

`contact.create` currently follows the CLI-exposed shape: <!-- id:x16wgexq -->

```ts <!-- id:G30ZI7yY -->
{
  subject: string
  name: string
}
```

`contact.delete` requires a contact record ID. Unlike the CLI, this first implementation does not resolve a contact CID through `/ipfs/<cid>` before deletion. <!-- id:43P5B2mp -->

# Profiles <!-- id:uZO1uLGo -->

Profile writes use shared blob helpers from `@shm/shared/blobs`: <!-- id:ELqZWV8D -->
  - `createProfile` <!-- id:V5ZKbk7d -->
  - `createProfileAlias` <!-- id:jIjqdhkj -->

`profile.update` publishes a profile blob. If the signer is a managed server-side HM account key, the secret metadata label is also updated so the Tools tab and future system prompts show the new profile name. <!-- id:POrPaBns -->

`profile.alias` decodes the provided alias principal and publishes an alias profile blob. <!-- id:VvKIFEoJ -->

# Desktop UI behavior <!-- id:Ox6GqjoM -->

The Tools tab now includes: <!-- id:W46a_5qY -->

```text <!-- id:wHs_PCsD -->
write — Write Seed content
```

The copy says selected account keys can be used to create, sign, and publish Seed content. The UI still autosaves tool toggles and signing key selection. <!-- id:9h8sIvRc -->

`write` should be explicitly enabled by the user. It is not enabled by default for existing agents. <!-- id:qfHdhB9x -->

# Integration test details <!-- id:e1s7NY9m -->

The main integration test is in `agents/src/api-service.test.ts`: <!-- id:IJ4ozWBS -->

```text <!-- id:Rpqcw5fI -->
runs write profile and draft tool calls with selected signing identities
```

It mocks `globalThis.fetch` for both: <!-- id:R28ziDvA -->
  - OpenAI-compatible streaming tool-call responses; <!-- id:ep4pMNgz -->
  - Seed `PublishBlobs` calls. <!-- id:RoevCLJS -->

The model mock emits `write` tool calls for: <!-- id:WtZL9-Qs -->
  - `profile.update` <!-- id:Lud4Oz6S -->
  - `draft.create` <!-- id:-voiof93 -->
  - `capability.create` <!-- id:9ov-ssOH -->
  - `contact.create` <!-- id:B5dQYcaa -->

The test verifies: <!-- id:PYvjRLbR -->
  - Pi/OpenAI payload exposes both `read` and `write` when configured. <!-- id:B1S8votn -->
  - The prompt includes the selected signing identity profile name. <!-- id:5OBfcnPA -->
  - Tool results are returned into the Pi message loop. <!-- id:PA1cfAsy -->
  - Four publish calls occur: <!-- id:3NreprTu -->
    1. profile publish during signing identity creation; <!-- id:UOnX_mgN -->
    2. profile update from `write`; <!-- id:jYUjh5di -->
    3. capability create; <!-- id:O19fMnyx -->
    4. contact create. <!-- id:kXIBHrPJ -->
  - A draft row is stored. <!-- id:RM6RHDNO -->
  - Markdown frontmatter metadata, including `summary`, is preserved in `metadata_cbor`. <!-- id:HEzIb3hE -->

# Validation run during implementation <!-- id:7xLdQp_v -->

The following validations passed after this implementation: <!-- id:bW-bdloc -->

```bash <!-- id:HxriTSUN -->
cd agents && bun check
cd agents && bun test
pnpm typecheck
git diff --check
```

# Subagent review feedback applied <!-- id:K5He14yq -->

A reviewer subagent flagged several issues. The critical ones were fixed: <!-- id:OdRmaV3W -->

## Arbitrary write server selection <!-- id:HdBjusAf -->

Problem: accepting `server`/`dev` would allow the model to publish signed blobs to arbitrary endpoints. <!-- id:hucaPpok -->

Fix: `write` rejects `server` and `dev` for writes and always uses the configured agent HM server. <!-- id:rLH-WlC9 -->

## Draft scoping <!-- id:7DMidKhi -->

Problem: drafts were account-scoped only. <!-- id:nrb3cCwW -->

Fix: draft get/update/list/delete/publish access is now scoped by both account and agent. <!-- id:atUoNn9J -->

Other fixes applied from review: <!-- id:T2vG5-5G -->
  - `draft.list` excludes soft-deleted drafts. <!-- id:1tsiJOjq -->
  - `document.update` uses block diffing instead of naive replacement ops. <!-- id:AhNJpLuY -->
  - `document.redirect` resolves and passes capability for delegated writes. <!-- id:JOODMvNb -->
  - JSON block input validates with `HMBlockNodeSchema`. <!-- id:TMwVw5KE -->
  - Metadata is size-limited. <!-- id:R4ICtNK3 -->
  - Tools tab copy was updated to reflect write tool availability. <!-- id:LmzusnEg -->

# Known limitations and follow-ups <!-- id:4tK7zPs0 -->

This is a broad first slice, but it is not the final polished write system. <!-- id:j9EK_XpZ -->

## Document creation does not yet include file:// link resolution <!-- id:REdud7bi -->

The CLI resolves `file://` links in markdown/JSON blocks and metadata into IPFS blobs. The current tool does not resolve local files. This is probably correct for server-side Agents until there is a clear file-upload story, but it is a CLI-parity gap. <!-- id:rqTAb9wP -->

## PDF input is not implemented <!-- id:Y4XaAUtL -->

The CLI can import PDFs through `pdfToBlocks`. The tool currently supports only markdown and JSON. <!-- id:or_7RnqU -->

## `document.create` force/existing-path behavior is incomplete <!-- id:XjEhuCpf -->

The CLI checks existing document paths and requires `--force` to avoid accidental lineage replacement. This implementation does not yet perform that exact guard. <!-- id:1H1lHaST -->

## `document.update --delete-blocks` parity is not implemented <!-- id:4U1dw6Ql -->

The tool uses replacement diffing for full-content updates, but it does not expose a separate `deleteBlocks` input like CLI `--delete-blocks`. <!-- id:RvoQMcqd -->

## `document.update --parent` is not implemented <!-- id:ygi5p3wJ -->

The CLI declares `--parent`, though the current CLI implementation may not use it meaningfully. The tool does not implement parent insertion semantics. <!-- id:DxhTtAkR -->

## Draft publish ignores some stored routing fields <!-- id:vpEjTUk2 -->

`draft.publish` currently distinguishes update vs create through `edit_target`; it does not fully implement all `location_target`, `visibility`, and path semantics from CLI drafts. <!-- id:faUGCJUe -->

## Contact update is not implemented <!-- id:kzFALZxm -->

The SDK supports `updateContact`, but the CLI currently exposes create/delete/list. The initial tool implements create/delete only. <!-- id:6k2MSg9J -->

## Capability revoke is not implemented <!-- id:Y-12JQBe -->

The CLI currently exposes capability create. Revoke semantics are not implemented here because they were not found in the CLI audit. <!-- id:oeRpeZnO -->

## Contact delete by CID is not implemented <!-- id:pJWNTvM2 -->

The CLI accepts either a contact record ID or CID and can resolve the CID through `/ipfs/<cid>`. The tool currently expects a record ID. <!-- id:4Ky1izX7 -->

## Rich UI rendering is not implemented <!-- id:gPW_yFcf -->

Tool results persist as structured events and fall back to JSON rendering. A future UI pass should render write results with command, signer, IDs, versions, and CIDs. <!-- id:qFincCqH -->

## Dedicated audit table is not implemented <!-- id:BbsUUNcy -->

Durable session tool events are the current audit trail. A dedicated write audit table may be useful later. <!-- id:JgPXOjjE -->

## Write confirmation/dry-run-first policy is not implemented <!-- id:hDq1FO7_ -->

The tool supports `dryRun` for many commands, but there is no user policy requiring dry run before publish. <!-- id:lerw9mKM -->

# Suggested next implementation priorities <!-- id:dL8zKCPb -->

1. Improve `draft.publish` to fully honor CLI draft routing: <!-- id:F-sgcvIb -->
   - `edit` <!-- id:xu_PmAX5 -->
   - `location` <!-- id:gTagqcnL -->
   - `visibility` <!-- id:UbvzhPyo -->
   - `path` <!-- id:wP6JUDCX -->
2. Add document create existing-path/`force` guard. <!-- id:XIziDqAO -->
3. Add document metadata/file-link handling strategy for server-side Agents. <!-- id:N9W-40mv -->
4. Add direct tests for signer resolution edge cases: <!-- id:rWVc8w8J -->
   - omitted signer with one identity; <!-- id:bpisi4Ca -->
   - omitted signer with multiple identities; <!-- id:Rj-HnkQ9 -->
   - ambiguous profile names; <!-- id:64VXMDk7 -->
   - unselected public key rejection. <!-- id:TjWBIi-9 -->
5. Add direct tests for document create/update publishing with mocked Resource/ListChanges/PublishBlobs responses. <!-- id:SojVaqec -->
6. Add rich UI rendering for `write` results. <!-- id:tyL7CrEH -->
7. Consider splitting `write` implementation out of `api-service.ts` once the shape stabilizes. <!-- id:c50YeAbh -->
