# Fix Comment Link Copy

## Problem

When copying a comment link, the URL format is incorrect in both the main section and right panel contexts.

### Current (broken) behavior

Both contexts produce `?panel=comment/COMMENT_ID` — only difference is `:discussions` in the path:

- **Main section**: `path/:discussions?panel=comment/AUTHOR/TSID`
- **Right panel**: `path?panel=comment/AUTHOR/TSID`

### Bugs

1. **URL generation** (`entity-id-url.ts` `createCommentUrl`): main section comments put comment ID in `panel=` query param instead of in the path.
2. **Lost openComment** (`routes.ts` `createDocumentNavRoute` line 363-364): `case 'discussions'` ignores panelParam entirely, so `/:discussions?panel=comment/...` loses the comment ID.
3. **Panel override** (`routes.ts` `createDocumentNavRoute` line 372-375): `default` case redirects `panel=comment/...` to main discussions view instead of keeping it as a right panel.

### Desired behavior

- **Main section** (discussions view): `path/:comment/AUTHOR/TSID?l`
  - Comment ID is a **path segment** after `:comment`
  - Opens discussions view with comment focused
- **Right panel** (document view): `path?l&panel=comment/AUTHOR/TSID`
  - Comment ID is a **query param** `panel=comment/...`
  - Opens document with discussions panel scrolled to comment

### Backward-compat

Old URLs like `/:discussions?panel=comment/COMMENT_ID` should still work — they resolve to the discussions main view with the comment focused (no duplicate panel).

## Detection logic (unchanged)

`comments.tsx:643-645` already detects context correctly:

```typescript
const currentRoute = useNavRoute()
const isDiscussionsView =
  currentRoute.key === 'discussions' || currentRoute.key === 'activity'
```

- Main section → route key is `'discussions'` → `isDiscussionsView=true`
- Right panel → route key is `'document'` → `isDiscussionsView=false`

No changes needed for detection.

## Changes

### 1. `frontend/packages/shared/src/utils/entity-id-url.ts`

#### `createCommentUrl` (line 152-190)

- **Main section** (`isDiscussionsView=true`): set `viewTerm: ':comment/' + commentId`, `panel: null`
- **Right panel** (`isDiscussionsView=false`): keep `viewTerm: null`, `panel: 'comment/' + commentId` (unchanged)

#### `extractViewTermFromUrl` (line 65-92)

Add `:comment/AUTHOR/TSID` regex pattern (similar to `:activity/<slug>`):
- Pattern: `/:comment/AUTHOR/TSID` before query/fragment
- Return new `commentId` field when detected
- Strip the `:comment/...` portion from the returned URL

### 2. `frontend/packages/shared/src/routes.ts`

#### `createDocumentNavRoute` (line 344-380)

- Fix `case 'discussions'` (line 363-364): when panelParam starts with `comment/`, extract openComment and return `{key: 'discussions', id: docId, openComment}`. This also handles backward-compat for old `/:discussions?panel=comment/...` URLs.
- Fix `default` case (line 371-378): remove the special case that redirects `panel=comment/...` to main discussions view. Let it flow through to `{key: 'document', id: docId, panel}` so the panel created by `createPanelRoute` (which already handles `comment/COMMENT_ID`) is used correctly.

### 3. `frontend/apps/web/app/routes/$.tsx`

#### `extractViewTermFromPath` (line 48-80)

Add `:comment` pattern detection (3 path segments: `:comment`, AUTHOR, TSID):
- Check third-to-last path part for `:comment`
- Return `commentId` = `AUTHOR/TSID`

#### Caller code (~line 275-286)

When `commentId` is extracted:
- Set `viewTerm = 'discussions'`
- Set `effectivePanelParam = 'comment/' + commentId`

This feeds into `createDocumentNavRoute(docId, 'discussions', 'comment/...')` which (after fix #2) correctly produces `{key: 'discussions', id: docId, openComment}`.

### 4. `frontend/apps/desktop/src/components/titlebar-common.tsx`

Handle the new `commentId` from `extractViewTermFromUrl`:
- When commentId is present after resolving a URL, create a discussions route with `openComment` instead of applying the generic view term

### 5. `frontend/apps/desktop/src/components/search-input.tsx`

Similar handling for `commentId` from `extractViewTermFromUrl`.

### 6. `frontend/packages/shared/src/utils/__tests__/entity-id-url.test.ts`

- Update `createCommentUrl` test expectations: main section URLs change from `:discussions?panel=comment/...` to `:comment/...`
- Add tests for `extractViewTermFromUrl` with `:comment/AUTHOR/TSID` patterns
