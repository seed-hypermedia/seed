# Comment Request Spam Investigation

Date: 2026-05-28  
Affected release: 2026.5.5  
Area: Desktop sync/activity/comment UI

## Summary

The most likely source of the production request storm is the desktop activity sync loop in
`frontend/apps/desktop/src/app-sync.ts`.

For every new `Comment` activity event, the sync loop calls:

```ts
grpcClient.comments.getComment({id: cid})
```

The backend implements `GetComment` by calling `BatchGetComments` with a single ID, so frontend `GetComment` spam can
appear in logs as `BatchGetComments` spam.

## Likely Request Path

```txt
desktop app focused
  -> activity monitor polls every ~1s
  -> receives Comment events
  -> processEventsInner()
  -> calls grpcClient.comments.getComment() once per comment CID
  -> backend GetComment()
  -> backend BatchGetComments([id])
```

This matches reports of large numbers of `BatchGetComments` requests while sitting on comment screens or writing
comments.

## Amplifiers

After detecting any comment event, the sync loop blanket-invalidates many query families:

- `DOCUMENT_COMMENTS`
- `DOCUMENT_DISCUSSION`
- `BLOCK_DISCUSSIONS`
- `COMMENTS`
- `AUTHORED_COMMENTS`
- `COMMENT_VERSIONS`
- `ACTIVITY_FEED`
- `FEED`

Mounted comment/feed views then refetch, causing additional comment/list/reply-count requests.

## Why `main` May Feel Better

`main` does not appear to remove this frontend request generator, but it includes backend contention/performance fixes
after `2026.5.5`, especially:

- `37b54c67b`: coalesces peer writes and marks `BatchGetComments` read-only-style.
- `123e81fdb`: defers/splits peer startup cleanup.

These likely reduce SQLite/write-lock contention, making the app freeze less under the same request pattern.

## Proposed Hotfix

### 1. Stop Per-Comment `GetComment` in Activity Sync

Modify `frontend/apps/desktop/src/app-sync.ts`.

Remove the async per-comment lookup:

```ts
Promise.allSettled(commentCids.map((cid) => grpcClient.comments.getComment({id: cid})))
```

Do not fetch every comment just to invalidate interaction summaries.

### 2. Prefer Target Info from Activity Mention Events

Use `newCitation` events where:

```ts
sourceType === 'comment/target'
```

to derive affected target docs and invalidate:

```ts
[queryKeys.DOCUMENT_INTERACTION_SUMMARY, targetDocId]
```

If target info is unavailable, skip targeted summary invalidation rather than issuing N comment fetches.

### 3. Narrow Comment Invalidations

Longer-term, avoid blanket invalidating all comment-related query families. Prefer target-specific keys where possible.

## Tests to Add

In `frontend/apps/desktop/src/__tests__/app-sync-activity.test.ts`, add tests that verify:

1. Processing `Comment` events does not call `grpcClient.comments.getComment`.
2. `comment/target` mention events invalidate `DOCUMENT_INTERACTION_SUMMARY` for the target doc.
3. Multiple comment events are batched/deduplicated.
4. Existing comment query invalidations still fire as expected.

## Validation

Manual repro/verification:

1. Run the desktop app with `SEED_SYNC_PROFILE=1`.
2. Open a document comment screen.
3. Create or write a second comment.
4. Watch console/network logs.
5. Confirm there is no repeated `GetComment`/single-ID `BatchGetComments` storm from the sync loop.
6. Confirm comments and interaction summaries still update.

Recommended checks:

```sh
pnpm test frontend/apps/desktop/src/__tests__/app-sync-activity.test.ts
pnpm typecheck
```

## Risk

Low-to-medium.

The hotfix may delay interaction summary count updates in cases where only raw comment events arrive without
corresponding `comment/target` mention events. This is preferable to freezing the app. Comment lists themselves still
refresh through existing comment invalidations.
