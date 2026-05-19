# Desktop Assistant Write Access Plan

## Goal

Allow the in-app desktop assistant to create and update Seed content while keeping write actions explicit, inspectable,
and safe by default.

The desktop assistant should be able to use the shared `write` tool API for selected write operations, especially:

- creating comments and threaded replies;
- creating documents;
- updating documents;
- later, publishing drafts or other write commands if they have clear product UX.

This is separate from the standalone Agents service, which already wires the `write` tool through server-side signing
identities. The desktop assistant must write as the current local user/account and should use the same local
signing/publishing paths as the existing desktop UI.

## UX Model

Add a control in the assistant panel header, near the top right:

- label: `Auto-approve writes` or `Allow writes without asking`;
- default: disabled;
- scope: current local desktop user/account, persisted locally or session-scoped depending on product preference.

Behavior:

1. When disabled, every assistant write request becomes an inline confirmation card in the chat.
2. The user can approve or cancel the write.
3. When enabled, the assistant can execute supported writes immediately.
4. The UI must make the enabled state visually obvious so users know the assistant can mutate content.

## Confirmation Flow

When the model calls `write` and auto-approval is disabled:

1. The `write` tool executor creates a pending write request.
2. The chat displays an inline confirmation card with:
   - write command, e.g. `comment.create`;
   - target document/comment/resource;
   - signer/current account;
   - content preview;
   - relevant metadata such as title, path, reply parent, or dry-run status;
   - `Approve` and `Cancel` actions.
3. The tool execution waits for the user decision.
4. On approval, the write executes and the model receives the write result.
5. On cancellation, the model receives a structured tool rejection result so it can explain that the user cancelled.

This avoids inventing a second “proposal” tool. The model still uses the real `write` tool, but the local runtime gates
execution.

## Runtime Architecture

### Current state

The shared registry defines `write`, but desktop chat does not currently register a local executor.

- Desktop assistant tools in `frontend/apps/desktop/src/app-chat.ts` currently include:
  - `search`
  - `read`
  - `list_activity_feed`
  - `navigate`
- Agent service tools in `agents/src/api-service.ts` include:
  - `read`
  - `list_activity_feed`
  - `write`
  - `set_session_title`

### Proposed state

Add `write` to the desktop assistant `chatTools` map in `frontend/apps/desktop/src/app-chat.ts`.

The executor should:

1. validate input against the shared registry schema;
2. restrict unsupported commands;
3. resolve the current local account/signer;
4. check the auto-approve setting;
5. either execute immediately or create a pending confirmation;
6. return a structured result compatible with existing write rendering.

## Initial Command Scope

Start with a deliberately small supported subset.

### `comment.create`

Priority: highest.

Required behavior:

- target the current document when the user says “comment on this” and document context is available;
- support explicit `input.target` HM document URLs;
- support threaded replies through `input.replyCommentId`;
- include enough preview data in confirmation cards to show the exact comment body and target;
- publish using local desktop signing/publishing infrastructure.

Potential implementation path:

- reuse `createComment` from `@seed-hypermedia/client/comment` if available in the desktop bundle;
- publish the generated blobs through the same local publish path used by existing comment UI;
- convert simple model text/markdown into HM paragraph blocks for v1.

### `document.create`

Priority: medium.

Required behavior:

- create a document under an explicit account/path or a safe default path chosen by the UI/runtime;
- preview title, path, and content;
- avoid overwriting existing content;
- require confirmation unless auto-approval is enabled.

### `document.update`

Priority: medium, but more dangerous.

Required behavior:

- require an explicit target document;
- fetch latest document/version before writing;
- fail safely on version conflicts;
- preview replacement scope clearly.

For v1, prefer full document replacement only if the confirmation makes that obvious. Fine-grained patching should wait
until there is a reliable block-level diff UX.

## Out of Scope for v1

Do not initially expose these commands to the desktop assistant:

- capability writes;
- contact writes;
- profile writes;
- document redirects/moves;
- destructive deletes;
- arbitrary draft mutation unless tied to a clear draft UX.

These can remain agent-service-only until there is a dedicated safety review and product flow.

## Safety Rules

- Default to confirmation required.
- Never execute a write from a hidden or ambiguous target.
- Prefer exact IDs and latest versions over inferred resources.
- Show the user the final content and target before approval.
- Return structured cancellation/rejection results to the model.
- Log metadata only; do not log full private content or signed payloads by default.
- Keep destructive commands disabled for the desktop assistant until explicitly designed.

## Data and State

Needed state:

- auto-approve setting;
- pending write requests keyed by session/tool call ID;
- approval/cancellation resolution for an in-flight tool call;
- persisted chat parts/results so confirmed writes render after reload.

Recommended scope:

- store auto-approve as local desktop preference;
- keep pending write promises in memory only;
- if the app restarts with pending writes, mark them cancelled/expired.

## UI Implementation Notes

Files likely involved:

- `frontend/apps/desktop/src/components/assistant-panel.tsx`
  - add the header checkbox/toggle;
  - render pending write confirmation actions;
  - pass approval/cancel actions to the chat model layer.
- `frontend/apps/desktop/src/components/assistant-message-rendering.tsx`
  - extend `WriteToolCallBubble` to render pending/approved/rejected write states;
  - keep generic fallback for unknown write output shapes.
- `frontend/apps/desktop/src/app-chat.ts`
  - register desktop `write` tool;
  - implement confirmation-gated executor;
  - implement supported local write commands.
- `frontend/apps/desktop/src/models/chat.ts`
  - subscribe to pending-write events;
  - expose approve/cancel mutations or IPC calls.

The confirmation card should be compact but explicit. It should show what will change, not just the raw JSON args.

## Tool Result Shape

Use existing write result conventions where possible:

```ts
type DesktopWriteResult = {
  type: 'hypermedia_write_result'
  command: string
  signer?: {
    publicKey?: string
    profileName?: string
  }
  result: Record<string, unknown>
}
```

For user rejection:

```ts
type DesktopWriteRejected = {
  type: 'hypermedia_write_error'
  command: string
  message: 'User rejected write request'
  details?: {
    reason: 'cancelled' | 'expired'
  }
}
```

Pending state can be represented in chat rendering metadata rather than returned to the model, because the model should
only receive the final approved/rejected result.

## Open Questions

1. Should auto-approve be global, per account, or per chat session?
2. Should auto-approve allow all supported writes or only non-destructive writes like `comment.create`?
3. Should document writes always require confirmation even when auto-approve is enabled?
4. What is the preferred local API for publishing generated comment/document blobs from the main process?
5. Should the assistant be allowed to write to private/local-only documents?
6. Should markdown conversion support only paragraphs in v1, or a richer subset?

## Suggested Milestones

### Milestone 1: Confirmation infrastructure

- Add assistant header toggle.
- Add pending write event plumbing.
- Add inline approval/cancel card.
- Add tests for pending, approved, cancelled rendering.

### Milestone 2: `comment.create`

- Add local desktop `write` tool executor for `comment.create` only.
- Resolve current account/signer.
- Convert simple text to HM blocks.
- Publish comments using existing local desktop publishing infrastructure.
- Add tests for confirmation required and auto-approved execution.

### Milestone 3: document creation/update

- Add `document.create` with confirmation preview.
- Add guarded `document.update` with latest-version conflict checks.
- Add tests for safe failure and conflict handling.

### Milestone 4: polish and hardening

- Improve previews and rendering.
- Add persistence behavior for approved/rejected results.
- Add telemetry/logging with content redaction.
- Consider additional commands after safety review.
