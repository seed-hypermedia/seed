# Deleted Document Parent Embed Cleanup

## Problem

When a user deletes a document, parent documents can still contain embeds pointing at the deleted document. The result
is stale UI: document cards, block links, or content embeds remain visible and can render a “deleted document” state.

This is especially confusing when the deleted document was represented in its parent as a card or block-link embed.
Users expect deleting the child document to also remove the corresponding parent reference.

The remaining product gap is parent drafts: if the parent has an active draft, cleanup must update the draft
automatically, but the document machine/editor may currently prevent external draft edits from appearing in the open
editor state.

## Solution

Completed in this session:

- Added a shared cleanup planner for published `HMDocument` content.
- The planner removes any block-level `Embed` pointing at the deleted document.
- Matching ignores version and block refs, so block links such as `hm://uid/path#block` match the deleted document.
- Children of removed embeds are preserved by lifting them into the removed embed’s parent level.
- Added a durable desktop cleanup actor that runs after delete succeeds.
- The actor processes one cleanup job at a time and retries failures.
- The actor now checks for a parent draft in `loadingParent`.
- The actor stores `isDraft` and `parentDraftId` in job context.
- In `updating`, the actor updates either:
  - the parent draft, if one exists; or
  - the published parent document, if no draft exists.
- Added debug logs so real-world failures can be diagnosed from app logs.
- Added tests for published parent cleanup, block-link cleanup, child preservation, retries, and draft-target selection.

User stories covered:

- As a user, when I delete a child document, I do not want stale embeds for that document left in the parent.
- As a user, if a deleted document embed has nested blocks, I want those nested blocks preserved instead of deleted
  accidentally.
- As a user, if the parent has a draft, I expect the draft to be the cleanup target instead of publishing a new parent
  version behind my back.

## Scope

Completed scope:

- Shared planner for published document block cleanup.
- Desktop main-process cleanup actor.
- Retryable cleanup state machine.
- Draft detection and draft write path.
- Debug instrumentation for draft cleanup diagnosis.
- Unit coverage for the core behavior.

Remaining follow-up scope:

- Investigate active document machine behavior when draft files are updated externally.
- Decide how the open editor should receive automatic cleanup changes.
- Implement an in-memory draft/editor update path if direct draft writes remain invisible while the parent draft is
  open.

Suggested next iteration:

- 0.5 day: collect logs and confirm whether the draft file is updated correctly.
- 0.5–1 day: trace document machine behavior for external draft writes.
- 1–2 days: implement the chosen automatic editor synchronization strategy.
- 0.5 day: add integration/regression tests around open parent draft behavior.

## Rabbit Holes

- Rewriting the whole document machine or draft persistence model.
- Building a generalized external-edit reconciliation system before confirming this specific cleanup path.
- Handling recursive cleanup for all deleted descendants; current requirement only needs the selected deleted document’s
  parent reference.
- Adding a visible cleanup queue UI before we know whether users need it.
- Trying to solve stale editor state with sleeps or timing delays.

## No Gos

- Do not delete child blocks nested under a removed embed; they must be preserved/lifted.
- Do not publish the parent document when a parent draft exists; update the draft target instead.
- Do not silently ignore cleanup failures; keep retry/failure state and logs.
- Do not treat only document cards as cleanup targets; any `Embed` pointing at the deleted document should be removed.
- Do not rely on a manual reload as the final UX for parent draft cleanup.
