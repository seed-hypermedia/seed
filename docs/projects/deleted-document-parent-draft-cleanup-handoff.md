# Deleted Document Parent Draft Cleanup Handoff

## Context

When a user deletes a document, we need to remove embeds in the parent that point to the deleted document. This works
for published parent documents by publishing a parent update that removes matching `Embed` blocks.

The unresolved issue is the same cleanup when the parent document has an open/local draft. The cleanup actor can write
the draft file, but the UI can still show the embed in the “deleted document” state. The current hypothesis is that the
document machine/editor is preventing or masking draft edits that come from outside the active editor session.

## Desired UX

- User deletes a document.
- If the parent has a draft, the parent draft should update automatically.
- Any embed in that parent draft pointing at the deleted document should disappear.
- Children of the removed embed should be preserved/lifted into the same level.
- The user should not have to manually remove the stale embed or reload to avoid seeing “deleted document”.

## What Is Currently Implemented

Relevant files:

- `frontend/apps/desktop/src/app-document-card-cleanup.ts`
- `frontend/packages/shared/src/utils/document-card-cleanup.ts`
- `frontend/apps/desktop/src/__tests__/app-document-card-cleanup.test.ts`
- `frontend/packages/shared/src/utils/document-card-cleanup.test.ts`

The cleanup actor currently:

1. Runs after document delete succeeds.
2. Derives the deleted document’s parent ID.
3. Enters `loadingParent`.
4. Checks for a parent draft via `drafts.findByEdit({ editUid, editPath })`.
5. Stores `isDraft` and `parentDraftId` on the job context.
6. Enters `updating`.
7. If a draft exists, updates the draft only.
8. If no draft exists, updates/publishes the published parent document.

The draft update path currently scans `draft.content` for editor blocks:

```ts
block.type === 'embed'
block.props?.url targets the deleted document
```

Matching is document-level: it ignores version and block refs, so these should match the same deleted document:

- `hm://uid/path`
- `hm://uid/path?v=...`
- `hm://uid/path#block-id`
- `hm://uid/path?l#block-id`

## Debug Logs Added

Log lines start with:

```text
Document embed cleanup
```

Most useful log messages:

- `Document embed cleanup job started`
- `Document embed cleanup parent draft lookup`
- `Document embed cleanup parent draft load`
- `Document embed cleanup target selected`
- `Document embed cleanup draft scan`
- `Document embed cleanup writing parent draft`
- `Document embed cleanup parent draft written`
- `Document embed cleanup draft skipped; no matching embeds`

The most important line is `Document embed cleanup draft scan`. It includes:

- `draftId`
- `deletedDocumentId`
- `topLevelBlockCountBefore`
- `topLevelBlockCountAfter`
- `inspectedEmbeds`: each inspected embed with `{ id, view, url, matches }`
- `removedBlockIds`

## Suspected Problem

The draft file/query may be updated, but the active document machine/editor appears to own the in-memory draft state.
External writes to a draft may not be applied automatically to the open editor state.

The cleanup actor now broadcasts:

```ts
{
  type: 'draft_externally_modified', draftId
}
```

That currently triggers the existing UX that tells open windows the draft changed externally. However, this may only
show a reload toast or may not be enough for the document machine to merge/remove blocks automatically.

## Things To Verify Next

1. Reproduce with parent draft open.
2. Paste logs containing `Document embed cleanup`.
3. Confirm whether `draft scan` reports the target embed with `matches: true`.
4. Confirm whether `removedBlockIds` includes the embed block ID.
5. Confirm whether `parent draft written` appears.
6. Inspect the draft JSON on disk after cleanup to see if the embed block is actually removed.
7. If the file is correct but UI is stale, the next fix should be in the document machine/editor synchronization path,
   not in the cleanup planner.

## Likely Next Strategy

If the active document machine blocks external draft writes, we probably need one of these approaches:

- Teach the document machine to accept a targeted external cleanup event and apply the block removal to its in-memory
  editor state.
- Route cleanup through the draft/document machine when that draft is open, instead of writing the draft directly from
  the actor.
- Add a stronger draft reload/rebase mechanism for external changes that can apply structural deletes without forcing a
  full page reload.

The most user-friendly version is an automatic in-memory update of the open parent draft, not a reload toast.
