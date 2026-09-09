# Reliable document references

## Problem

A document can exist without being discoverable from its parent. Publishing a child, changing its path, moving it, or
removing it changes more than one document, but those changes do not succeed as a single transaction. A successful child
publication followed by a failed parent update leaves an unreferenced document. A partially completed move can leave a
stale card in one parent and no card in the other.

Drafts make this more consequential. A parent may have unpublished work when a child operation needs to update its
published content. Publishing the entire draft would expose work the user has not approved. Updating only the published
parent without reconciling the draft leaves the editor working from an obsolete baseline, risking conflicting versions,
lost reference corrections, or separate document heads. Stale caches can hide a successful correction until a reload.

The user also needs a clear distinction between editing a reference and deleting a document. Removing the last reference
to a direct child can express deletion intent, but an absent card alone is not proof: an inline link or self-query may
still reference that child. Destructive consequences must be reviewed before publication.

Failures currently need to be understandable beyond the moment they happen. A toast is not enough to recover after a
restart, and dismissing an error should not destroy the evidence needed to diagnose an unreferenced document later.

**The project succeeds when users can trust that child operations either maintain their parent references or leave a
specific, durable, reviewable action—without silently publishing draft work or deleting children without consent.**

## Solution

### Separate the document action from its recoverable follow-up

Keep the user's primary action and parent-reference maintenance as separate operations. Record the follow-up intent
before the primary action where possible, but hold it until that action succeeds or its outcome can be verified. A
failed parent update must not reverse a successful child publication. If persistence itself fails, warn the user rather
than claiming the follow-up is safely queued.

Use the existing shared [XState v5](https://stately.ai/docs/actors) implementation rather than adding another queue:

| Responsibility                                                                 | Owner                          | Reason                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------- |
| Queue ordering, retry budgets, scheduling, and recovery commands               | One coordinator                | Keeps policy in one place and avoids independent retry loops racing each other.             |
| One attempt to add, remove, rewrite, or materialize an approved child deletion | A short-lived job actor        | Gives each attempt a clear lifecycle and outcome without requiring a machine per operation. |
| Reference matching and content changes                                         | Shared planners and validators | Keeps document semantics consistent between web and desktop and independently testable.     |
| Storage, signing, document/draft access, timers, and cache notifications       | Platform adapters              | Accounts for real platform differences without duplicating the workflow.                    |

Persist **job data and verified checkpoints**, not running promises. After a restart, create fresh actors that inspect
the current state. The coordinator runs one job at a time locally. Retryable failures receive an initial attempt plus
three retries with backoff; exhausted or unsafe work becomes Needs attention. A delayed retry preserves ordering for its
parent without preventing unrelated parents from progressing.

On desktop, the coordinator lives in the Electron main process and serves all renderer windows. On web, a root-mounted
host starts recovery outside document routes; an exclusive Web Lock lets one tab drain the durable command inbox and
queue at a time. Both recover per device/browser profile, not across devices, and neither executes while the app is
closed.

### Lifecycle and restart contract

An attempt follows an explicit sequence:

1. **Verify the primary action.** A held intent cannot change a parent until the child's publication, move, or deletion
   is confirmed. On recovery, require captured evidence such as the signed version or original redirect identity;
   finding a document at the path is not sufficient proof.
2. **Load and plan.** Read the current published parent and calculate the smallest required reference correction.
   Already-correct content produces no duplicate card or unnecessary edit. A missing parent ends that maintenance job
   without recreating the parent.
3. **Publish and verify.** Apply the reference-only change when needed, read back the parent, and record the verified
   publication version as a durable checkpoint.
4. **Reconcile the draft.** Bring any parent draft and live editor forward to that baseline while preserving local
   edits. If this fails after publication, retain the checkpoint: recovery must finish reconciliation rather than
   blindly publish the same change again.
5. **Refresh and finish.** Invalidate the affected document and draft caches and notify editors so completed work is
   visible without a manual reload.
6. **Recover on failure.** Return the attempt's error to the coordinator. It schedules another attempt or keeps the
   action available for user attention. Approved child-deletion jobs use their own revalidation and deletion path; a
   card-removal job never becomes permission to delete a document.

The persisted job includes its identity and operation, structured source/destination IDs, signing context, failure
count, next retry deadline, last error, timestamps, and any verified parent-publication checkpoint. Destructive jobs
also retain approval scope and the authorizing parent version. Capture the original document locations so a later retry
cannot silently follow a moved child. Derive the hierarchical parent from those captured locations; store a separate
container only when it is genuinely different.

| Failed execution | Next action                                                    |
| ---------------- | -------------------------------------------------------------- |
| Initial attempt  | Eligible for retry after 1 second.                             |
| First retry      | Eligible for retry after 5 seconds.                            |
| Second retry     | Eligible for retry after 15 seconds.                           |
| Third retry      | Stop automatic attempts and retain the job in Needs attention. |

These are eligibility deadlines, not exact execution times. Another job, a closed app, or unavailable storage can delay
progress. The failure counter records failed attempts, not execution starts. Unsafe or unprovable outcomes may require
attention without exhausting ordinary retries.

Desktop stores the queue in its local application store; web stores queue records and commands in browser storage and
keeps drafts in the web draft database. On restart, restore records and deadlines, replace interrupted execution with
fresh attempts, and re-read documents before acting. Dismissed records stay non-runnable. Browser storage clearing or a
failed disk write is not recoverable merely because the workflow uses actors.

### Make the reference rules explicit

| User action                                 | Required behavior                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First publication                           | Add a card to the published parent unless the child is home/private, the parent is a collection, a self-query covers the children, or an existing card/link/inline reference already points to the child.                                 |
| Ordinary update                             | Do not insert another parent reference.                                                                                                                                                                                                   |
| Rename/path change                          | Rewrite existing reference destinations to the new path without deleting authored link text. Query results follow the changed document.                                                                                                   |
| Move                                        | Remove cards from the old parent and add a card to the destination only when the first-publication insertion rules require one. Reclaim a direct move redirect back to the same source when safe; do not overwrite an unrelated document. |
| Explicit document deletion                  | Remove matching cards from its parent. Do not automatically remove normal links or inline references.                                                                                                                                     |
| Publish removal of a child's last reference | Review deletion only for a direct child with authored removal intent and no surviving reference. Show the child and its descendant subtree and require explicit confirmation.                                                             |

A self-query counts as a reference to **all direct children**, independently of its display limit, filters, or sorting.
Replacing a card with that query must not propose deletion. Removing or retargeting the last **published** self-query
requires examining its full direct-child scope and excluding children still referenced elsewhere in the parent's
content. Adding and removing a never-published query alone does not authorize bulk deletion.

Deletion approval is tied to document identities, versions, and the reviewed subtree. Revalidate the authorizing parent,
current references, and deletion scope before execution. Never follow a moved target or silently expand approval to new
descendants. Restoring a dismissed destructive action requires fresh review and explicit consent.

### Show the impact on known references before deletion

Ordinary deletion, publication-triggered child deletion, and recovery deletion reviews show an expandable list of known
referring documents. The lookup covers the approved deletion scope, including descendants, deduplicates referring
documents, and excludes sources within that scope. Links from the remaining sources will break.

This is impact disclosure, not a veto: references elsewhere do not change the direct-parent deletion rule. Checking is
best-effort and does not block confirmation. Loading and lookup failures are visible; a failed lookup never implies
there are no references. The citation index may be incomplete or contain historical references, and its results are
bounded to protect the daemon. This is not a guarantee of a complete backlink audit across remote, private, or unsynced
documents.

### Correct the published parent without publishing its draft

Treat the published document and unpublished draft as separate layers:

1. Load the current published parent and calculate the reference-only correction.
2. Publish that correction against the published baseline, without including unrelated draft edits.
3. Verify and record the resulting parent version.
4. Rebase the draft's local changes onto that corrected baseline, preserving authored edits and reference-removal
   intent.
5. Save the rebased content, base blocks, dependencies, and maintenance revision together using the platform's
   concurrency checks. Clear block revision metadata when a block is changed.
6. Refresh parent and draft caches and notify mounted editors. Reconcile unsaved live edits rather than forcing a
   reload.

This is the logical equivalent of temporarily separating the draft edits, applying the correction, and restoring those
edits—not a reason to destructively strip and rewrite the live draft on disk. If reconciliation is unsafe, preserve the
user's work and surface the unresolved action.

For example, if a user deletes Child A's card in a parent draft and Child A is then renamed, the published parent must
contain the corrected card while the draft must continue to omit it. Discarding the draft restores the card at the
**new** path; publishing the draft instead requires reviewing Child A's deletion. The baseline and the draft express
different, intentional states.

Invalidation is part of completion, not cosmetic cleanup. Refresh inactive web caches so back navigation loads the new
parent, propagate changes across tabs/windows, and avoid hydrating a draft from cached content while its newer baseline
is still loading. The document actor must accept a fresh parent version even while waiting for draft resolution.

### Give recovery a durable, understandable home

- Put the maintenance entry beside Agents in desktop navigation and the equivalent web navigation. Show a compact
  Notifications banner for active work or queue-loading failures. Both open the same root-owned dialog.
- Always provide access through desktop General settings and the web account settings area/account menu, even when the
  queue is empty.
- Separate **Active** and **Dismissed** views. Dismissed actions stop retrying and never contribute to pending or
  attention counts. History alone leaves a neutral navigation entry, not a warning banner.
- Preserve dismissed records with timestamps, attempts, errors, affected documents, and completed steps. Keep up to 90
  days and the latest 500 records, pruning on startup and queue activity. Clearing history affects no active jobs and
  repairs no documents.
- Offer Review and retry for reference maintenance and renewed review/consent for destructive actions. Restoring a
  record moves it back to active work; this is a recovery history, not an immutable audit log.
- Let users explicitly copy a diagnostic report, with a warning that it includes document IDs, paths, and errors. Do not
  include signing capabilities or upload reports automatically. Previously erased dismissals cannot be reconstructed.

The deletion confirmation uses the existing expandable document list: titles and relative paths, not raw HM URLs. This
lets users understand the scope before choosing **Publish and delete**.

### Why this approach fits

This problem has a small number of explicit steps, asynchronous failures, partial completion, and restart boundaries. A
state machine makes those transitions inspectable and testable: “parent published, draft still needs reconciliation” is
a real checkpoint, not a boolean hidden in an exception handler. Job actors isolate individual attempts; the coordinator
provides ordering and retry policy without a growing collection of timers and callbacks.

The important property is **safe reconciliation on repeated attempts**, not an exactly-once promise. Checking current
references prevents duplicate cards. Publication checkpoints avoid unnecessarily repeating a successful parent update.
Fresh validation keeps delayed retries from acting on stale destructive assumptions. Failures that cannot be resolved
safely stop for review instead of being retried indefinitely.

A synchronous multi-document transaction would couple child publication to parent availability and does not match the
current backend guarantees. A server-wide workflow platform would add infrastructure, cross-device ownership, and
signing questions that local recovery does not need. Sharing a small coordinator and planners, while leaving I/O to
adapters, is a proportionate fit for two apps that must apply the same rules under different storage and lifecycle
constraints.

## Scope

The implementation is present in the working branch. This document is self-contained: it includes the product contract,
design rationale, operational lifecycle, recovery rules, delivery phases, and acceptance criteria needed to understand
and review the project. It can be imported as a single Seed document without importing companion files. Repository-only
source maps and exhaustive engineering checklists are not prerequisites for this brief.

| Phase                          | Deliverable and dependency                                                                                                                           | Current boundary                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Shared reconciliation model | Identity-aware planners, serializable jobs, one-attempt actors, queue ordering, bounded retries.                                                     | Implemented; foundation for both adapters.                              |
| 2. Platform integration        | Desktop main-process ownership, browser persistence and exclusive worker ownership, primary-action intents, publish/rename/move/delete entry points. | Implemented on top of Phase 1.                                          |
| 3. Draft and deletion safety   | Published-baseline corrections, draft/live-editor reconciliation, reference-aware deletion inspection and consent, freshness on navigation.          | Implemented on top of Phases 1–2.                                       |
| 4. Recovery experience         | Shared dialog, navigation and Notifications entry points, Settings access, dismissed history, diagnostic export, and safe restoration.               | Implemented on top of durable job state.                                |
| 5. Release verification        | Authenticated cross-app smoke tests, restart/failure injection, and review of remaining concurrency limits.                                          | Automated regressions exist; live end-to-end sign-off remains required. |

**Remaining planning allowance:** approximately 2–3 engineer-days for live verification and focused fixes once suitable
web and desktop environments and signing accounts are available. This is an estimate, not measured elapsed work or a
release commitment. Protocol changes or substantial findings require a separate estimate.

Acceptance should cover both happy paths and recovery:

- Publish, rename, move, and delete children; navigate back without reloading and see the correct parent.
- Repeat with a parent draft and unsaved editor changes. Publish from the updated baseline or discard to the corrected
  published version without losing unrelated work.
- Replace cards with inline links or self-queries without triggering deletion. Remove the final reference or published
  self-query and review only eligible direct children and their explicitly listed descendants.
- Interrupt work after parent publication but before draft reconciliation; restart and finish without duplicate cards.
- Exhaust retries, inspect the error, dismiss it, restart, and find its history without an attention badge. Verify
  Settings access with an empty queue and that clearing history leaves active work intact.
- Exercise browser tabs and desktop windows so local ownership, notification, and hydration behavior are verified—not
  merely inferred from isolated planner tests.

Automated tests do not prove a clean dependency audit or an authenticated end-to-end release. Keep those checks explicit
rather than describing the feature as transactionally complete.

## Rabbit Holes

- **A general workflow engine:** arbitrary job graphs, an actor class per operation, or multiple competing retry layers
  would obscure a small, understandable queue.
- **Cross-device recovery and background execution:** account-wide history, a server worker, and ownership transfer
  between devices introduce signing and synchronization requirements beyond this project.
- **Globally atomic destructive operations:** stronger expected-version and subtree preconditions require
  backend/protocol work. Local serialization and validation cannot solve unseen remote-write races.
- **Removing Discard changes:** this may simplify future editing UX, but the project must preserve its current meaning.
- **Query-result-by-result ownership:** display limits and filters must not turn routine query configuration into
  unpredictable deletion scope. A self-query represents the parent's direct children as a group.
- **A full audit or support telemetry product:** immutable event histories, automatic uploads, analytics, and indefinite
  retention are not needed to inspect dismissed local actions.
- **A global orphan sweep or reference rewrite:** repairing every historical orphan or modifying links in unrelated
  documents is a different project from maintaining the parent affected by a known operation.
- **Resuming an entire partially completed recursive move:** parent-reference recovery is not a general rollback or
  resume engine for the primary move itself. Ambiguous primary outcomes need review.

## No Gos

- Do not block or undo a successful child publication because parent maintenance failed.
- Do not publish unrelated parent draft edits, overwrite unsaved work to make reconciliation succeed, or use a stale
  draft baseline as if it were current.
- Do not create children under unpublished parents or bypass hierarchical edit authorization. Recheck authorization at
  execution boundaries.
- Do not programmatically remove normal links or inline references; automatic removal is limited to document cards.
  Renaming may update an existing destination without erasing its authored text.
- Do not delete a document merely because it is unreferenced. Require applicable removal intent, a direct-parent
  relationship, no surviving reference, and explicit consent covering the destructive scope.
- Do not count dismissed actions as unfinished attention items, automatically revive them on restart, or describe
  dismissal/clearing history as a repair.
- Do not silently overwrite an occupied move destination, follow a redirect to delete its target, or broaden approved
  deletion scope during retry.
- Do not promise exactly-once execution, crash-atomic desktop draft files, cross-device serialization, or elimination of
  every unreferenced document. Browser storage can fail or be cleared, and remote writes can race unconditional backend
  tombstones. Surface those boundaries rather than hiding them.
