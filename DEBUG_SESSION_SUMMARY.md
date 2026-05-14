# Debug Session Summary: Web Document Content Not Updating After Publish

## Symptom
When publishing a change on web, the main content area does not show the new version. After page reload, the versions panel (activity feed) shows the new version exists, but the main content still shows the old version. Desktop app (connected to the same local daemon) works correctly.

## Root Cause (identified, not yet fixed)

**File**: `frontend/apps/web/app/document-edit/web-document-actors.ts`

In `publishWebDocument()` (line ~347-371), after successful publish:

1. `setQueriesDataByKey` updates the React Query cache with the new document — correct
2. `invalidateQueries` marks the entity query as stale — correct  
3. **`refetchQueriesByKey([queryKeys.ENTITY, deps.docId.id])` — BUG**

The problem is in step 3. `refetchQueriesByKey` triggers the `queryFn` from `queryResource()` in `frontend/packages/shared/src/models/queries.ts`. This `queryFn` calls `client.request('Resource', id)` where `id` has `latest: true` and a **pinned version** (set during SSR via `loadResourcePayload` in `loaders.ts:393`).

Even though the daemon's `GetResource` handler (`backend/api/documents/v3alpha/resources.go:210-217`) handles the `l` flag and clears the version to fetch the latest, the daemon's "latest" pointer may not have caught up yet after the Ref publish. The publish code itself acknowledges this at line 318-322:

```ts
// Refetch the new HEAD by explicit version to bypass the universal client's
// default-cache GET on `/api/Resource`. The daemon may otherwise serve a
// cached "latest" pointer that hasn't yet caught up to the Ref we just
// promoted. Pinning the request to `changeCid` guarantees we read our new
// content back, not a stale snapshot of the previous HEAD.
```

So the sequence is:
1. Publish succeeds → Ref+blobs sent to daemon  
2. `setQueriesDataByKey` → cache has NEW content (fetched with explicit new CID)  
3. `invalidateQueries` → marked stale  
4. **`refetchQueriesByKey` → fetches with `latest: true`, daemon returns OLD content** (stale "latest" pointer)  
5. Cache overwritten with old content → main content shows old version

## Key Files Traced

| File | Role |
|------|------|
| `frontend/apps/web/app/document-edit/web-document-actors.ts` | Publish actor — where the bug is |
| `frontend/apps/web/app/loaders.ts` | SSR data loading — sets `finalId.version` to pinned version (line 393) |
| `frontend/packages/shared/src/models/queries.ts` | `queryResource()` — queryFn uses `id.version` for request (line 61-83) |
| `frontend/packages/shared/src/models/query-client.ts` | `setQueriesDataByKey`, `invalidateQueries`, `refetchQueriesByKey` |
| `frontend/apps/web/app/routes/hm.api.resource.$.tsx` | REST API endpoint — parses `v` and `l` params from IRI |
| `backend/api/documents/v3alpha/resources.go` | Daemon handler — clears version when `l` flag present (line 210-217) |
| `frontend/packages/client/src/client.ts` | Seed client — serializes Resource requests via `packHmId()` |
| `frontend/packages/client/src/hm-types.ts` | `packHmId()` — includes version in query string (line 1747-1759) |
| `frontend/packages/ui/src/resource-page-common.tsx` | `MainContent` — renders `blocks={existingDraftContent ?? document.content}` (line 2252) |
| `frontend/apps/web/app/web-resource-page.tsx` | `WebResourcePage` — passes `existingDraftContent` from IDB draft query |

## Proposed Fix

Remove `refetchQueriesByKey([queryKeys.ENTITY, deps.docId.id])` from the publish actor. The `setQueriesDataByKey` call already puts the correct data in the cache, and `invalidateQueries` ensures any future refetch will get fresh data. The immediate refetch is counterproductive because it fetches with `latest: true` which may hit a stale daemon cache.

Alternatively, if immediate refetch is desired, refetch with the explicit new version CID instead of `latest: true`.

### Specific change needed in `web-document-actors.ts` (~line 362-371):

```diff
  console.log('[Publish] step 8 detail: forcing background refetch')
  try {
      await Promise.all([
-         refetchQueriesByKey([queryKeys.ENTITY, deps.docId.id]),
          refetchQueriesByKey(['web-doc-draft', deps.docId.id]),
      ])
      console.log('[Publish] step 8 detail: background refetch finished')
  } catch (err) {
      console.warn('[Publish] step 8 detail: background refetch failed', err)
  }
```

## Verification
After making the fix, test by:
1. Load a document page on web
2. Edit content and publish
3. Main content should immediately show the new version without requiring a reload
4. Reload the page — main content should still show the latest version
5. Verify the desktop app still works correctly (no regression)
