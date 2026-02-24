# Comment URL Routing

This document describes the URL routing logic for comments/discussions across desktop and web apps.

---

## URL Format Rules

### View Term: `:comments`

The `:comments` view term replaces the old `:discussions` view term. Old URLs with `:discussions` are still parsed for backward compatibility.

| URL Pattern | Behavior |
|---|---|
| `/:comments` | Comments panel rendered in main section (full page) |
| `/:comments/UID/TSID` | Comments panel in main section, specific comment highlighted |
| `?panel=comments/UID/TSID` | Document content in main, comments panel in right sidebar with comment highlighted |
| `/:comments?panel=comments/UID/TSID` | Comments in main section + comments panel in right sidebar with comment highlighted |

### Comment ID Format

Comment IDs in URLs are always two segments: `UID/TSID` (e.g., `z6Mk.../z6FC...`).

- `UID` = author/owner account ID
- `TSID` = timestamp-based comment ID

### Backward Compatibility

| Old Format | Maps To |
|---|---|
| `/:discussions` | `/:comments` |
| `?panel=comment/UID/TSID` | `?panel=comments/UID/TSID` |
| `?panel=discussions/BLOCKID` | `?panel=comments/BLOCKID` |

---

## URL Generation

### `routeToUrl()` (entity-id-url.ts)

Generates full URLs from `NavRoute` objects. Used for omnibar display, clipboard, and sharing.

- `{key: 'comments', id}` → `.../:comments`
- `{key: 'comments', id, openComment: 'UID/TSID'}` → `.../:comments/UID/TSID`
- `{key: 'comments', id, panel: {key: 'comments', openComment: 'UID/TSID'}}` → `.../:comments?panel=comments/UID/TSID`
- `{key: 'document', id, panel: {key: 'comments', openComment: 'UID/TSID'}}` → `...?panel=comments/UID/TSID`

### `routeToHref()` (routing.tsx)

Generates `href` attributes for `<a>` tags. Same path logic as `routeToUrl` but without query params (panel state is handled via the route object in navigation context).

### `createCommentUrl()` (entity-id-url.ts)

Context-aware URL builder for the "Copy Comment Link" button:

- **Main panel** (`isDiscussionsView: true`): Comment ID goes in the URL path
  - `https://site.com/doc/:comments/UID/TSID`
- **Right panel** (`isDiscussionsView: false`): Comment ID goes in query param
  - `https://site.com/doc?panel=comments/UID/TSID`

---

## URL Parsing

### `extractViewTermFromUrl()` (entity-id-url.ts)

Used by desktop omnibar and titlebar. Extracts view term from a full URL string.

- Input: `https://site.com/path/:comments/z6Mk/z6FC?panel=...`
- Output: `{url: 'https://site.com/path?panel=...', viewTerm: ':comments', commentId: 'z6Mk/z6FC'}`

Checks `:comments/UID/TSID` pattern (2 segments) before checking simple `:comments`.

### `extractViewTermFromPath()` (routes/$.tsx)

Used by the web app's Remix loader. Extracts view term from URL path segments.

- Input: `['doc', ':comments', 'z6Mk', 'z6FC']`
- Output: `{path: ['doc'], viewTerm: 'comments', commentId: 'z6Mk/z6FC'}`

Checks 3-segment pattern (`:comments/UID/TSID`) before 2-segment (`:activity/slug`) before 1-segment (`:comments`).

---

## Route Creation

### `createDocumentNavRoute()` (routes.ts)

Central function that converts parsed URL parts into a `NavRoute` object.

```typescript
createDocumentNavRoute(
  docId: UnpackedHypermediaId,
  viewTerm?: ViewRouteKey | null,      // 'comments', 'activity', etc.
  panelParam?: string | null,          // 'comments/UID/TSID', etc.
  openComment?: string | null,         // from URL path /:comments/UID/TSID
): NavRoute
```

**Decision matrix for `comments` viewTerm:**

| viewTerm | panelParam | openComment | Result |
|---|---|---|---|
| `'comments'` | `null` | `null` | `{key: 'comments', id}` |
| `'comments'` | `null` | `'UID/TSID'` | `{key: 'comments', id, openComment}` |
| `'comments'` | `'comments/UID/TSID'` | `null` | `{key: 'comments', id, panel: {key: 'comments', openComment}}` |
| `null` | `'comments/UID/TSID'` | `null` | `{key: 'document', id, panel: {key: 'comments', openComment}}` |

---

## Reply Button Behavior

### Main panel (comments full page)

When `route.key === 'comments'`, clicking Reply:
```typescript
replace({...route, openComment: replyComment.id, isReplying: true})
```
URL becomes: `/:comments/UID/TSID`

### Right panel (document + comments sidebar)

When route is `document` or other, clicking Reply:
```typescript
replace({...route, panel: {key: 'comments', id: docId, openComment: replyComment.id, isReplying: true}})
```
URL becomes: `?panel=comments/UID/TSID`

### External target comment

When clicking Reply on a comment that targets a different document:
```typescript
navigate({key: 'document', id: targetRoute, panel: {key: 'comments', id: targetRoute, openComment: replyComment.id, isReplying: true}})
```
Navigates to the target document with comments panel open.

---

## Desktop Omnibar Resolution Flow

1. User pastes URL into omnibar
2. `extractViewTermFromUrl()` extracts view term + commentId from URL, returns cleaned URL
3. `viewTermToRouteKey()` converts `:comments` → `'comments'`
4. URL is resolved via `resolveHypermediaUrl()` (HTTP) or `unpackHmId()` (hm://)
5. `createDocumentNavRoute()` creates base route from resolved ID + panel param
6. `applyViewTermToRoute()` converts `{key: 'document'}` → `{key: 'comments', openComment}` using the extracted commentId
7. Navigation happens

## Web App Resolution Flow

1. Remix loader receives request URL
2. `extractViewTermFromPath()` extracts view term + commentId from path segments
3. `loadSiteResource()` fetches document data, passes `viewTerm`, `panelParam`, `openComment` as extra data
4. Component calls `createDocumentNavRoute(data.id, data.viewTerm, data.panelParam, data.openComment)`
5. Route is used as `initialRoute` for `WebSiteProvider`

---

## Files Reference

| File | Role |
|---|---|
| `shared/src/routes.ts` | Route schemas (Zod), `createDocumentNavRoute`, `createPanelRoute` |
| `shared/src/utils/entity-id-url.ts` | URL generation (`routeToUrl`, `createCommentUrl`, `createWebHMUrl`), URL parsing (`extractViewTermFromUrl`) |
| `shared/src/routing.tsx` | `routeToHref`, `useRouteLink` |
| `shared/src/utils/navigation.tsx` | `getRouteKey` |
| `desktop/src/components/search-input.tsx` | Omnibar URL handler, `applyViewTermToRoute` |
| `desktop/src/components/titlebar-common.tsx` | Titlebar URL bar, `applyViewTerm` |
| `desktop/src/pages/desktop-resource.tsx` | Desktop `onReplyClick` handler |
| `web/app/routes/$.tsx` | Web catch-all loader, `extractViewTermFromPath` |
| `web/app/routes/_index.tsx` | Web index route |
| `web/app/web-resource-page.tsx` | Web `onReplyClick` handler |
| `ui/src/comments.tsx` | Copy Comment Link button |
| `ui/src/resource-page-common.tsx` | `ResourcePage` content rendering |

---

## QA Test Specifications

### Web — Comment URL Routing

| ID | Description |
|---|---|
| WC-01 | Navigate to `/:comments` on a document with comments. The page must render a comments list in the main content area without any document content visible. |
| WC-02 | Navigate to `/:comments` on the home document (root path). The comment editor must be visible above the comments list. |
| WC-03 | Navigate to `/:comments/UID/TSID` where UID/TSID is a valid comment ID. The comments list must render in the main content area and the specified comment must be visually highlighted (e.g., `bg-accent` class). |
| WC-04 | Navigate to `?panel=comments/UID/TSID` (no view term). The document content must render in the main area and a comments panel must be visible in the right sidebar with the specified comment highlighted. |
| WC-05 | Navigate to `/:comments?panel=comments/UID/TSID`. The comments list must render in the main content area AND a comments panel must be visible in the right sidebar with the specified comment highlighted. |
| WC-06 | Navigate to `/:discussions` (old URL format). The page must redirect or render the comments view identically to `/:comments` (backward compatibility). |
| WC-07 | Navigate to `?panel=comment/UID/TSID` (old `comment/` prefix). The document must render in the main area with a comments panel in the right sidebar, same as `?panel=comments/UID/TSID` (backward compatibility). |
| WC-08 | On the comments main view (`/:comments`), click the "Copy Comment Link" button on any comment. The clipboard must contain a URL with the comment ID in the path: `.../:comments/UID/TSID` (no `?panel=` query param). |
| WC-09 | On a document with the comments right panel open (`?panel=comments/UID/TSID`), click the "Copy Comment Link" button on any comment. The clipboard must contain a URL with the comment ID in the query param: `...?panel=comments/UID/TSID` (no `:comments` view term in path). |
| WC-10 | On the comments main view (`/:comments`), click the "Reply" button on a comment. The URL must update to `/:comments/UID/TSID` where UID/TSID is the comment being replied to, and the reply editor must be focused. |
| WC-11 | On a document with comments in the right panel, click the "Reply" button on a comment. The URL must update to include `?panel=comments/UID/TSID` and the reply editor must be focused in the right panel. |

### Desktop — Comment URL Routing

| ID | Description |
|---|---|
| DC-01 | Paste a URL ending in `/:comments` into the omnibar and press Enter. The comments view must render in the main content area. |
| DC-02 | Paste a URL ending in `/:comments/UID/TSID` into the omnibar and press Enter. The comments view must render in the main content area with the specified comment highlighted. |
| DC-03 | Paste a URL with `?panel=comments/UID/TSID` (no view term) into the omnibar and press Enter. The document content must render in the main area and a comments panel must be visible in the right sidebar with the specified comment highlighted. |
| DC-04 | Paste a URL ending in `/:comments?panel=comments/UID/TSID` into the omnibar and press Enter. The comments list must render in the main content area AND a comments panel must be visible in the right sidebar with the specified comment highlighted. |
| DC-05 | On the comments main view, click the "Reply" button on a comment. The URL in the omnibar must update to show `/:comments/UID/TSID` and the reply editor must appear. |
| DC-06 | On a document with comments in the right panel, click the "Reply" button. The URL in the omnibar must update to include `?panel=comments/UID/TSID` and the reply editor must appear in the right panel. |
| DC-07 | On the comments main view, click the "Copy Comment Link" button. The clipboard URL must contain `/:comments/UID/TSID` in the path (not as a query param). |
| DC-08 | On a document with comments in the right panel, click the "Copy Comment Link" button. The clipboard URL must contain `?panel=comments/UID/TSID` as a query param (no `:comments` view term in path). |
| DC-09 | Paste a URL with the old `/:discussions` view term into the omnibar. The app must navigate to the comments view (backward compatibility). |
| DC-10 | Paste a URL with the old `?panel=comment/UID/TSID` format (singular `comment/`) into the omnibar. The app must open the document with the comments right panel and highlighted comment (backward compatibility). |
| DC-11 | Paste a URL ending in `/:comments/UID/TSID` into the titlebar URL field and press Enter. The comments view must render with the specified comment highlighted (same behavior as omnibar). |
