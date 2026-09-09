# Document reference reconciliation

For the project framing and design rationale, see
[Reliable document references](projects/document-reference-reconciliation.md). This document is the detailed
implementation checklist.

For actor responsibilities, state diagrams, persistence, and platform wiring, see the
[actor model guide](document-reference-actor-model.md).

## Agreed behavior

- Both web and desktop use the shared XState coordinator and one-attempt job actors. Extend the existing cleanup system
  rather than introducing another queue.
- Recovery is per device/browser profile. Jobs survive ordinary restarts, but do not execute while the app is closed and
  do not synchronize across devices.
- The coordinator owns durable retry counts and retry scheduling. Use an initial attempt plus three retries for
  transient failures. Unresolved work is retained in Needs attention with manual retry and review.
- Failed parent maintenance or draft reconciliation never reverses or blocks a successful child publication.
- On first publication, add a card to the published parent unless the child is home/private, the parent is a collection,
  the parent has a self-referencing query, or any direct reference to the child already exists.
- A self-query suppresses card insertion regardless of filters or pagination. An unrelated query does not suppress
  insertion.
- Ordinary child updates do not enqueue new parent cards.
- Rename rewrites existing reference destinations; it does not remove authored text. A query alone requires no rewrite.
- Move removes cards from the old parent and adds a card at the destination only under the same insertion eligibility
  rules as first publication.
- Explicit child deletion removes cards from the parent, not normal links or inline references. Only the editor/user
  removes those references.
- Child creation requires an already-published, editable parent. Verify every creation/destination entry point rather
  than assuming the existing visibility guard enforces this.
- Edit permission is hierarchical; avoid a separate per-descendant permission-resolution workflow. Execution still
  enforces authorization.
- Job payloads should use validated `UnpackedHypermediaId` objects. Derive hierarchical parents from the captured
  source/destination path; only arbitrary-container reference edits need a separate container. Persisting the original
  location prevents retries from following a moved child.

## Published baseline and drafts

Publish reference-only corrections against the published parent, never against its unpublished draft. Then rebase the
latest draft onto the corrected published version, update its base content and dependencies, invalidate queries, and
reconcile any live editor.

Never temporarily erase the user's draft. If a card was deleted in the draft and the child is renamed, the published
baseline must contain the renamed card while the rebased draft continues to omit it. Discard restores the corrected
published baseline. A new child's required card must also exist in the published baseline even when the parent has a
draft.

Persist publication and draft-reconciliation progress independently. Retry reloads current state and resumes unfinished
work; a successful parent publication must not be repeated merely because draft reconciliation failed. An unsafe merge
preserves unpublished edits and becomes Needs attention. Introducing a new blocking parent-editor conflict UX was not
approved.

## Last-reference deletion

Track user reference-removal intent and validate it against the final parent content. Cards, inline references, and
normal document links all count. A remaining direct reference prevents inferred child deletion. Absence alone never
implies deletion. Undo, restoration, draft discard, and system-generated maintenance must not authorize deletion.

When publication removes the last direct reference to a direct child, warn that publishing will delete that child and
its entire descendant subtree. Require explicit confirmation listing the deletion scope. Persist that scope and
completed steps. New descendants or relocated targets during recovery require renewed confirmation; retries must not
silently widen consent or follow moved targets.

Removing or narrowing a query never enqueues child deletion. Unreferenced children caused by query changes are allowed
for now. Query-removal review UI and replacement-card remediation are deferred.

## Implementation stages

### 1. Shared rules and recovery regressions

Files: `frontend/packages/shared/src/utils/document-card-cleanup.ts`, its adjacent test file,
`frontend/packages/shared/src/models/document-card-cleanup-machine.ts`, and
`models/__tests__/document-card-cleanup-machine.test.ts`.

- [x] Prepare regressions for non-card reference preservation, all-reference insertion suppression, rename rewrites, and
      self-query suppression.
- [x] Prepare regressions for current-clock timer ticks, unrelated work during retry delays, interrupted-job recovery,
      and manual retry/dismiss.
- [x] Observe these regressions fail, implement minimal fixes, and rerun shared tests.
- [x] Make retry ownership explicit in the coordinator; one-attempt actors report outcomes rather than scheduling
      retries themselves.
- [x] Recover interrupted job records and handle unexpected actor errors without stopping the coordinator.
- [x] Restore durable queue records instead of resuming stale promise snapshots; expose manual retry/dismiss in both
      adapters.
- [x] Make queue intake resilient to storage failures before executing side effects.
- [x] Migrate the legacy job fields to structured IDs, deriving hierarchical parents at execution boundaries.
- [x] Ensure superseded moves/deletions cannot replay obsolete card additions.

### 2. Safe parent publication and draft rebasing

Files: `frontend/packages/shared/src/utils/document-changes.ts`, `document-changes-rebase.test.ts`,
`frontend/apps/desktop/src/app-document-card-cleanup.ts`,
`frontend/apps/web/app/document-edit/web-document-card-cleanup.ts`, their adapter tests, and the existing draft
storage/editor integration files as required.

- [x] Correct and test rebase behavior for local deletion versus remote rename, remote deletion versus unrelated local
      edits, inserted cards, block placement, and genuine conflicts.
- [x] Persist original published base separately from merged draft content, including empty baselines and web draft
      round-tripping.
- [x] Publish and verify the corrected parent even when its draft exists.
- [x] Rebase/update dependencies using the actual returned or reloaded publication version, not an optimistic synthetic
      version or block ID.
- [x] Coordinate draft writes with live editing/autosave so reconciliation cannot overwrite newer edits.
- [x] Update both stored draft and live editor baseline; verify discard restores the corrected published parent.
- [x] Persist partial progress and expose failures without changing the child operation's success.

### 3. Integrate both applications

Files: desktop `models/auto-link-parent.ts`, `models/documents.ts`, publish actors/callers; web
`document-edit/web-document-actors.ts`, move/delete dialogs; shared document-action planners.

- [x] Route first-publish and all rename/move/delete entry points through the shared queue.
- [x] Preserve inline child-draft card identity/placement when replacing temporary references.
- [x] Enforce collection/self-query/existing-reference suppression consistently.
- [x] Remove draft-only success paths and catch-all missing-parent handling that currently swallow operational failures.
- [x] Verify publication and destination guards, including previously supported nested unpublished drafts.
- [x] Address the crash window between committing the primary operation and persisting follow-up work with a durable
      intent record and reconciliation of its primary outcome.

### 4. Confirmed child-subtree deletion

Files: shared reference helpers and document publish workflow; existing web/desktop delete operations and shared
confirmation dialog.

- [x] Persist user removal candidates and distinguish them from system operations.
- [x] Revalidate all remaining direct references against the final draft before confirmation.
- [x] Enumerate and confirm child-plus-descendant scope before committing publication.
- [x] Publish the parent and materialize confirmed deletions through durable jobs with per-target progress.
- [x] On retry, verify target identity/location and subtree scope; route changed scope to attention for renewed consent.
- [x] Test undo/discard, duplicate references, query changes, partial deletion, moved targets, new descendants, and
      reference restoration before a delayed deletion runs.

### 5. Needs attention and verification

- [x] Expose persistent attention items on both apps with affected document, operation, completed steps, failure reason,
      retry, and review actions.
- [x] Manual dismissal does not imply successful repair; destructive retries with changed scope require renewed
      confirmation.
- [x] Reuse existing UI patterns; distinguish child success from pending parent maintenance.
- [ ] Finish shared, desktop, web, editor, client, and UI regression suites, typechecks, audit, workspace formatting,
      and relevant Agent CI workflow.
- [ ] Complete authenticated live verification on both apps; record actual URLs in test notes. Jean currently reports no
      run environments.

## Current implementation and release boundaries

The application workflows are now integrated: structured job identities, held primary intents, publication/read-back
checkpoints, parent-draft reconciliation, authored removal tracking, confirmed subtree deletion, scope renewal, and
Needs attention on both apps. Web workers serialize fresh hydration and execution with Web Locks; commands use separate
durable inbox keys. Desktop runs its worker in the main process. Ordinary updates do not enqueue new parent cards.

Draft saves use compare-and-swap plus invalidated-baseline tracking. A maintenance revision token also protects
same-head draft-only corrections from delayed autosaves. Rejected stale saves retain recovery snapshots rather than
replacing the corrected active draft. Live editors preserve unsaved content and report unsafe merges to Needs attention.

### Explicit limitations

- Recovery is local and runs only while the application/page is open. Cleared browser data or a storage device refusing
  writes cannot provide durable recovery. Primary actions may still succeed with a manual-maintenance warning.
- If a primary outcome cannot be proved after restart, the intent becomes Needs attention. Desktop first publication may
  require manual review when its exact publication identity was not durably captured; mere path existence is not
  accepted as proof.
- Removing the last published self-query now reviews all direct children that lose their final reference. A surviving
  self-query prevents deletion regardless of its display limit. An unresolvable removed external URL cannot safely
  identify a child and does not authorize deletion. This can leave an unreferenced document for manual review.
- Desktop draft serialization coordinates Electron operations, not external CLI filesystem edits. Its existing separate
  index/content files are not a crash-atomic filesystem transaction.
- Child deletion uses unconditional, timestamp-based backend tombstones. Latest references, versions, identity, and
  scope are checked again before each write, but unseen remote edits can race those checks. No globally serializable or
  exactly-once destructive transaction is claimed. Tombstones hide resources without erasing the underlying content
  blobs.
- Resuming a partially completed primary recursive move is outside the parent-maintenance queue; uncertain primary
  outcomes remain reviewable rather than speculative.

### Verification status

The new behavior has shared, platform-adapter, storage-concurrency, and component regressions. Final integrated suite
results are recorded in the implementation handoff. Authenticated live publication/discard/restart testing is still a
release gate; Jean returned no configured/running environments for this session. Agent CI is unavailable because the
Docker daemon socket is absent.

Four editor/client test failures were reproduced on an isolated export of unchanged HEAD
`37647d0148eb10cb3552dbae011eafddb5f3b7b9`: editor gallery overlay, editor SSR table search label, client Search
response fixture missing `nextPageToken`, and the macOS vault-path fixture expectation. They are not caused by this
implementation.

Dependency audit on 2026-09-08 reports 17 findings against unchanged dependency manifests/lockfile. Non-ignored high
findings are [toml uncontrolled recursion](https://github.com/advisories/GHSA-82x6-q7mm-w9cf) and
[toml prototype pollution](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j). Dependency remediation is outside this
reference-maintenance change.

### Final automated results

- Shared: 1,187 passed, 1 skipped.
- UI: 447 passed.
- Web: 236 passed, 1 skipped.
- Desktop unit: 795 passed, 1 skipped.
- Editor: 406 passed, the 2 independently reproduced baseline failures above.
- Client: 351 passed, the 2 independently reproduced baseline failures above.

All six touched package typechecks, final workspace formatting checks, documentation links, and `git diff --check`
passed. No authenticated live-app result or clean dependency audit is implied by these automated results.
