# All Documents Page — Implementation Spec

A full-page sitemap-style table view of every document under a site, with
tree-based hierarchy, sorting, filtering, expand/collapse, and multi-select.

Accessible from the Library sidebar (desktop), the three-dots options menu (both
desktop and web), and via URL view-term `/:all-documents`.

---

## Table of Contents

1. [Install dependency](#1-install-dependency)
2. [shadcn Table primitives](#2-shadcn-table-primitives)
3. [Route definition](#3-route-definition)
4. [URL / view-term handling](#4-url--view-term-handling)
5. [Navigation key](#5-navigation-key)
6. [Tree-building pure functions](#6-tree-building-pure-functions)
7. [Tests](#7-tests)
8. [Shared UI component](#8-shared-ui-component)
9. [ResourcePage integration](#9-resourcepage-integration)
10. [Desktop wiring](#10-desktop-wiring)
11. [Web wiring](#11-web-wiring)
12. [Omnibar URL display](#12-omnibar-url-display)
13. [Options menu refactor](#13-options-menu-refactor)
14. [File summary](#14-file-summary)
15. [Edge cases](#15-edge-cases)
16. [Verification checklist](#16-verification-checklist)

---

## 1. Install dependency

**File:** `frontend/packages/ui/package.json`

Add `@tanstack/react-table` (v8.20+):

```json
"@tanstack/react-table": "^8.20.6"
```

Then run `pnpm install` from repo root.

---

## 2. shadcn Table primitives

**New file:** `frontend/packages/ui/src/components/table.tsx`

Standard shadcn/ui table primitives using raw HTML elements + Tailwind + `cn()`.
Components: `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`,
`TableHead`, `TableCell`, `TableCaption`.

```tsx
import * as React from 'react'
import {cn} from '../utils'

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({className, ...props}, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-sm', className)}
      {...props}
    />
  </div>
))
Table.displayName = 'Table'

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({className, ...props}, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({className, ...props}, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({className, ...props}, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({className, ...props}, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-border hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
      className,
    )}
    {...props}
  />
))
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({className, ...props}, ref) => (
  <th
    ref={ref}
    className={cn(
      'text-muted-foreground h-10 px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className,
    )}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({className, ...props}, ref) => (
  <td
    ref={ref}
    className={cn(
      'p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className,
    )}
    {...props}
  />
))
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({className, ...props}, ref) => (
  <caption
    ref={ref}
    className={cn('text-muted-foreground mt-4 text-sm', className)}
    {...props}
  />
))
TableCaption.displayName = 'TableCaption'

export {
  Table, TableHeader, TableBody, TableFooter,
  TableHead, TableRow, TableCell, TableCaption,
}
```

---

## 3. Route definition

**File:** `frontend/packages/shared/src/routes.ts`

### Add schema

```ts
export const allDocumentsRouteSchema = z.object({
  key: z.literal('all-documents'),
  id: unpackedHmIdSchema,
})
export type AllDocumentsRoute = z.infer<typeof allDocumentsRouteSchema>
```

### Add to discriminated union

Add `allDocumentsRouteSchema` to the `navRouteSchema` `z.discriminatedUnion('key', [...])`.

### Add to `createDocumentNavRoute`

```ts
case 'all-documents':
  return {key: 'all-documents', id: docId}
```

### Recents

In `getRecentsRouteEntityUrl`, the `all-documents` key should return `null` (not
a recentable route).

---

## 4. URL / view-term handling

**File:** `frontend/packages/shared/src/utils/entity-id-url.ts`

1. Add `':all-documents'` to `VIEW_TERMS` array
2. Add `'all-documents'` to `ViewRouteKey` union type
3. Add mapping in `viewTermToRouteKey`: `':all-documents': 'all-documents'`
4. In `routeToUrl`, add `route.key === 'all-documents'` to the view-term route
   condition block (alongside `activity`, `directory`, `collaborators`, `discussions`)
5. In that same block, use spread `...route.id` when calling `createWebHMUrl` so
   that version/blockRef are preserved:
   ```ts
   return createWebHMUrl(route.id.uid, {
     ...route.id,
     hostname: opts?.hostname,
     originHomeId: opts?.originHomeId,
     viewTerm: viewTermPath,
     panel: effectivePanelParam,
   })
   ```

**URL patterns:**
- Site-hosted: `https://example.com/:all-documents`
- Gateway: `https://hyper.media/hm/UID/:all-documents`

---

## 5. Navigation key

**File:** `frontend/packages/shared/src/utils/navigation.tsx`

In `getRouteKey()`, add before the default return:

```ts
if (route.key === 'all-documents') return `all-documents:${route.id.uid}`
```

---

## 6. Tree-building pure functions

**New file:** `frontend/packages/shared/src/utils/all-documents-tree.ts`

Two pure functions that take flat `HMDocumentInfo[]` and produce a tree/flat
row array. No React, no hooks — easy to test.

### Types

```ts
export type DocumentTreeNode = {
  doc: HMDocumentInfo
  children: DocumentTreeNode[]
  depth: number
}

export type FlatRow = {
  doc: HMDocumentInfo
  depth: number
  hasChildren: boolean
  pathKey: string
}
```

### `buildDocumentTree(docs: HMDocumentInfo[]): DocumentTreeNode[]`

Algorithm:
1. Create `Map<pathKey, HMDocumentInfo>` from `doc.path.join('/')`. Skip root
   (empty path `[]`).
2. For each doc, find parent key by walking up path segments to nearest existing
   ancestor. If `docs/api/endpoints` exists but `docs/api` doesn't, attach to
   `docs` (or root).
3. Build `childrenMap: Map<parentPathKey, HMDocumentInfo[]>`.
4. Recursively build subtrees, sorting children alphabetically by display name
   at each level.

### `flattenTree(nodes, expandedPaths, sortFn?): FlatRow[]`

Walk tree depth-first. Only descend into children if `expandedPaths.has(pathKey)`.
Optional `sortFn` reorders siblings (used for column sorting).

### Full implementation

```ts
import {getMetadataName} from '../content'
import {HMDocumentInfo} from '../hm-types'

export type DocumentTreeNode = {
  doc: HMDocumentInfo
  children: DocumentTreeNode[]
  depth: number
}

export function buildDocumentTree(docs: HMDocumentInfo[]): DocumentTreeNode[] {
  const pathMap = new Map<string, HMDocumentInfo>()
  for (const doc of docs) {
    const key = doc.path?.join('/') ?? ''
    if (key === '') continue // skip root
    pathMap.set(key, doc)
  }

  const childrenMap = new Map<string, HMDocumentInfo[]>()

  pathMap.forEach((doc, pathKey) => {
    const parts = pathKey.split('/')
    let parentKey = ''
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidate = parts.slice(0, i).join('/')
      if (pathMap.has(candidate) || candidate === '') {
        parentKey = candidate
        break
      }
    }
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, [])
    childrenMap.get(parentKey)!.push(doc)
  })

  function buildSubtree(pathKey: string, depth: number): DocumentTreeNode[] {
    const children = childrenMap.get(pathKey) ?? []
    children.sort((a, b) => {
      const nameA = getMetadataName(a.metadata) ?? a.path?.join('/') ?? ''
      const nameB = getMetadataName(b.metadata) ?? b.path?.join('/') ?? ''
      return nameA.localeCompare(nameB)
    })
    return children.map((doc) => ({
      doc,
      depth,
      children: buildSubtree(doc.path?.join('/') ?? '', depth + 1),
    }))
  }

  return buildSubtree('', 0)
}

export type FlatRow = {
  doc: HMDocumentInfo
  depth: number
  hasChildren: boolean
  pathKey: string
}

export function flattenTree(
  nodes: DocumentTreeNode[],
  expandedPaths: Set<string>,
  sortFn?: (a: DocumentTreeNode, b: DocumentTreeNode) => number,
): FlatRow[] {
  const result: FlatRow[] = []
  function walk(nodes: DocumentTreeNode[]) {
    const sorted = sortFn ? [...nodes].sort(sortFn) : nodes
    for (const node of sorted) {
      const pathKey = node.doc.path?.join('/') ?? ''
      const hasChildren = node.children.length > 0
      result.push({doc: node.doc, depth: node.depth, hasChildren, pathKey})
      if (hasChildren && expandedPaths.has(pathKey)) {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return result
}
```

**Note:** Uses `for...of` on arrays and `Map.forEach` which work without
`downlevelIteration`. Avoid `for...of` on `Map` or spreading `Set` in this
package since the desktop tsconfig doesn't enable `downlevelIteration`.

---

## 7. Tests

**New file:** `frontend/packages/shared/src/__tests__/all-documents-tree.test.ts`

Run with: `pnpm -F @shm/shared test run all-documents-tree`

Test cases:
1. **builds tree from flat docs** — verifies nesting, child counts
2. **excludes root doc (empty path)** — root should not appear in tree
3. **sorts children alphabetically by name** — verifies order
4. **handles orphaned docs (missing intermediate parent)** — deep child attaches
   to nearest existing ancestor
5. **supports multiple nesting levels** — verifies depth values through 4 levels
6. **shows only top-level when nothing is expanded** — collapsed state
7. **expands children when path is in expanded set** — expand behavior
8. **collapsed parent hides children** — all rows at depth 0

See the full test file content in the [tree-building section](#6-tree-building-pure-functions)
implementation — test file uses a `makeDoc` helper to create `HMDocumentInfo`
fixtures.

---

## 8. Shared UI component

**New file:** `frontend/packages/ui/src/all-documents-page.tsx`

Single shared component used by both desktop and web. Renders INSIDE
ResourcePage (not standalone) — see [section 9](#9-resourcepage-integration).

### Props

```ts
export interface AllDocumentsPageProps {
  siteId: UnpackedHypermediaId
  onNavigateToDocument: (id: UnpackedHypermediaId) => void
}
```

### Data fetching

- `useDirectory(siteId, {mode: 'AllDescendants'})` — all docs for site
- `useAccountsMetadata(allAuthorUids)` — resolve author avatars
- `useInteractionSummary(docId)` — per-row citation count (lazy, via small
  `CitationCell` sub-component)

### Table columns (`@tanstack/react-table`)

| # | Column | Sort | Size | Notes |
|---|--------|------|------|-------|
| 1 | Select | No | 40px | Checkbox, header = select-all |
| 2 | Title | Yes | flexible | Tree indent (`depth * 24px`), chevron toggle, doc name. Click navigates. |
| 3 | Authors | No | 120px | `FacePile` from resolved `accountsMetadata` |
| 4 | Citations | No | 90px | Lazy `useInteractionSummary` per row |
| 5 | Comments | Yes | 100px | `activitySummary.commentCount` |
| 6 | Updated | Yes | 140px | Formatted date from `updateTime` |
| 7 | Actions | No | 50px | Placeholder (empty for now) |

### Features

- **Sorting**: Clickable headers. Sort reorders siblings within their parent to
  preserve hierarchy. Uses `manualSorting: true` + custom `sortFn` passed to
  `flattenTree`.
- **Filtering**: Title filter `<Input>` with search icon. When active,
  `findMatchingAncestors()` auto-expands parents of matching nodes so they're
  visible.
- **Multi-select**: Checkbox per row + header select-all. Bulk action bar shown
  when `selectedCount > 0` (placeholder for now).
- **Expand/collapse**: Chevron in Title column. All collapsed by default.

### Table layout (important for overflow)

Use `table-fixed` on `<Table>` to prevent horizontal overflow:
- Title column: `w-auto` (fills remaining space), cells `max-w-0 overflow-hidden`
- Other columns: explicit `style={{width: header.getSize()}}` from column def

### Visual hierarchy for nested rows

- Row backgrounds: `bg-muted/30` for `depth > 0`, `bg-muted/50` for `depth > 1`
- Title cell: left border accent `border-muted-foreground/20 border-l-2` for nested items
- Indentation: `marginLeft: (depth - 1) * 24 + 4` for `depth > 0`

### Layout

Full edge-to-edge, no PageLayout wrapper:

```tsx
<div className="flex h-full flex-col px-4">
  <div className="border-border flex items-center gap-4 border-b px-4 py-3">
    {/* "All Documents" title, spacer, selected count, search input */}
  </div>
  <div className="flex-1 overflow-auto">
    <Table className="table-fixed">...</Table>
  </div>
</div>
```

---

## 9. ResourcePage integration

**File:** `frontend/packages/ui/src/resource-page-common.tsx`

The all-documents page renders INSIDE `ResourcePage`, not as a standalone page.
This gives it the site header, breadcrumbs, document tools toolbar, and options
menu for free.

### Changes to `resource-page-common.tsx`

1. **`ActiveView` type** — add `'all-documents'`

2. **`getActiveView()`** — add `case 'all-documents': return 'all-documents'`

3. **`getPanelTitle()`** — add `case 'all-documents': return 'All Documents'`

4. **Breadcrumb labels** — add `'all-documents': 'All Documents'` to
   `panelLabels` object

5. **`DocumentTools` activeTab** — set to `undefined` when
   `activeView === 'all-documents'` (no tab should be highlighted)

6. **`OpenInPanelButton`** — exclude when `activeView === 'all-documents'`
   (not a valid panel route)

7. **Floating action buttons** — only show when `activeView === 'content'`

8. **`MainContent` switch** — add case:
   ```tsx
   case 'all-documents':
     return (
       <AllDocumentsPage
         siteId={hmId(docId.uid)}
         onNavigateToDocument={(id) => navigate({key: 'document', id})}
       />
     )
   ```

### Menu items refactor

The `useCommonMenuItems` hook was removed from `resource-page-common.tsx`. Menu
items are now fully controlled by the caller via `optionsMenuItems` prop (renamed
from `extraMenuItems`). Each platform (desktop, web) builds its own full menu
item list including copy link, versions, directory, and all-documents entries.

---

## 10. Desktop wiring

### Desktop page wrapper

**New file:** `frontend/apps/desktop/src/pages/all-documents.tsx`

Thin wrapper (exists for lazy-loading compat but currently routes through
`Document`/`DesktopResourcePage` instead):

```tsx
import {useNavigate} from '@/utils/useNavigate'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {AllDocumentsPage} from '@shm/ui/all-documents-page'

export default function AllDocumentsDesktopPage() {
  const route = useNavRoute()
  if (route.key !== 'all-documents') return null
  const navigate = useNavigate()
  return (
    <AllDocumentsPage
      siteId={route.id}
      onNavigateToDocument={(id) => navigate({key: 'document', id})}
    />
  )
}
```

### Register in main.tsx

**File:** `frontend/apps/desktop/src/pages/main.tsx`

Route `all-documents` through the existing `Document` page component (which is
`DesktopResourcePage`) so it renders inside `ResourcePage` with the site header:

```ts
case 'all-documents':
  return {
    PageComponent: Document,
    Fallback: DocumentPlaceholder,
  }
```

### Register in DesktopResourcePage

**File:** `frontend/apps/desktop/src/pages/desktop-resource.tsx`

Add `'all-documents'` to the `supportedKeys` array.

### Menu items in DesktopResourcePage

Add three menu items after the export item:

```ts
// Copy site URL link (if site has a custom domain)
if (siteUrl) {
  menuItems.push({
    key: 'link-site',
    label: `Copy ${displayHostname(siteUrl)} Link`,
    icon: <Link className="size-4" />,
    onClick: () => onCopySiteUrl(route),
  })
}

// Copy gateway link
menuItems.push({
  key: 'link',
  label: `Copy ${displayHostname(gwUrl)} Link`,
  icon: <Link className="size-4" />,
  onClick: () => onCopyGateway(route),
})

// ...existing items...

// Document Versions
menuItems.push({
  key: 'versions',
  label: 'Document Versions',
  icon: <HistoryIcon className="size-4" />,
  onClick: () => {
    replace({
      key: 'document',
      id: docId,
      panel: {key: 'activity', id: docId, filterEventType: ['Ref']},
    })
  },
})

// Directory
menuItems.push({
  key: 'directory',
  label: 'Directory',
  icon: <Folder className="size-4" />,
  onClick: () => navigate({key: 'directory', id: docId}),
})

// All Documents
menuItems.push({
  key: 'all-documents',
  label: 'All Documents',
  icon: <LayoutList className="size-4" />,
  onClick: () => navigate({key: 'all-documents', id: hmId(docId.uid)}),
})
```

Pass as `optionsMenuItems={menuItems}` (renamed from `extraMenuItems`).

### Library sidebar button

**File:** `frontend/apps/desktop/src/pages/library.tsx`

In `LibrarySiteItem`, add `group` class to the parent `<Button>` and add a
hover-visible icon button:

```tsx
<Tooltip content="All Documents">
  <button
    className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
    onClick={(e) => {
      e.stopPropagation()
      e.preventDefault()
      navigate({key: 'all-documents', id: hmId(site.id)})
    }}
  >
    <LayoutList className="size-3.5" />
  </button>
</Tooltip>
```

Import `LayoutList` from `lucide-react` and `Tooltip` from `@shm/ui/tooltip`.

---

## 11. Web wiring

### Web page wrapper

**New file:** `frontend/apps/web/app/web-all-documents-page.tsx`

```tsx
import {UnpackedHypermediaId} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {AllDocumentsPage} from '@shm/ui/all-documents-page'

export function WebAllDocumentsPage({siteId}: {siteId: UnpackedHypermediaId}) {
  const navigate = useNavigate()
  return (
    <AllDocumentsPage
      siteId={siteId}
      onNavigateToDocument={(id) => navigate({key: 'document', id})}
    />
  )
}
```

### Web routing

**File:** `frontend/apps/web/app/routes/$.tsx`

The `all-documents` route goes through `InnerResourcePage` (which renders
`WebResourcePage` → `ResourcePage`). The existing `extractViewTermFromPath` and
`createDocumentNavRoute` handle `:all-documents` automatically after the
entity-id-url changes. No separate branch needed in `$.tsx`.

### Web menu items

**File:** `frontend/apps/web/app/web-utils.tsx`

`useWebMenuItems` now accepts `docId: UnpackedHypermediaId` param. Adds
Document Versions, Directory, and All Documents menu items (same as desktop).
Gateway link uses `createWebHMUrl(docId.uid, {...})` instead of `routeToUrl`.

---

## 12. Omnibar URL display

**File:** `frontend/apps/desktop/src/components/titlebar-common.tsx`

### `getRouteId()`

Add `route.key === 'all-documents'` to the condition that returns `route.id`.

### `isUrlDisplayableRoute()`

Add `route.key === 'all-documents'` to the condition that returns `true`.

This makes the Omnibar show the correct URL
(e.g. `example.com/:all-documents`) when on the all-documents page.

---

## 13. Options menu refactor

As part of this feature, `useCommonMenuItems` was removed from
`resource-page-common.tsx`. The prop was renamed from `extraMenuItems` to
`optionsMenuItems`. Each platform now builds the complete menu item list:

- **Desktop** (`desktop-resource.tsx`): copy site link, copy gateway link,
  export, fork, share, versions, directory, all-documents, delete
- **Web** (`web-utils.tsx`): copy gateway link, versions, directory,
  all-documents

This gives each platform full control over which items appear and in what order.

---

## 14. File summary

### New files

| File | Purpose |
|------|---------|
| `frontend/packages/ui/src/components/table.tsx` | shadcn Table primitives |
| `frontend/packages/shared/src/utils/all-documents-tree.ts` | Tree-building pure functions |
| `frontend/packages/shared/src/__tests__/all-documents-tree.test.ts` | Tests for tree functions |
| `frontend/packages/ui/src/all-documents-page.tsx` | Shared AllDocumentsPage component |
| `frontend/apps/desktop/src/pages/all-documents.tsx` | Desktop page wrapper |
| `frontend/apps/web/app/web-all-documents-page.tsx` | Web page wrapper |

### Modified files

| File | Changes |
|------|---------|
| `frontend/packages/ui/package.json` | Add `@tanstack/react-table` |
| `frontend/packages/shared/src/routes.ts` | Route schema, union member, `createDocumentNavRoute` case |
| `frontend/packages/shared/src/utils/entity-id-url.ts` | VIEW_TERM, ViewRouteKey, viewTermToRouteKey, routeToUrl |
| `frontend/packages/shared/src/utils/navigation.tsx` | `getRouteKey` case |
| `frontend/packages/ui/src/resource-page-common.tsx` | ActiveView, MainContent switch, menu refactor, OpenInPanelButton guard |
| `frontend/apps/desktop/src/pages/main.tsx` | Route through Document page |
| `frontend/apps/desktop/src/pages/desktop-resource.tsx` | supportedKeys, menu items, optionsMenuItems rename |
| `frontend/apps/desktop/src/pages/library.tsx` | LayoutList hover button |
| `frontend/apps/desktop/src/components/titlebar-common.tsx` | getRouteId, isUrlDisplayableRoute |
| `frontend/apps/web/app/web-utils.tsx` | useWebMenuItems accepts docId, new menu items |

### Key existing code to reuse

| What | Import from |
|------|-------------|
| `useDirectory(id, {mode: 'AllDescendants'})` | `@shm/shared/models/entity` |
| `useInteractionSummary(docId)` | `@shm/shared/models/interaction-summary` |
| `useAccountsMetadata(uids)` | `@shm/shared/models/entity` |
| `Checkbox` | `@shm/ui/components/checkbox` |
| `Input` | `@shm/ui/components/input` |
| `FacePile` | `@shm/ui/face-pile` |
| `getMetadataName(metadata)` | `@shm/shared` |
| `formattedDate(date)` | `@shm/shared/utils/date` |
| `hmId(uid)` | `@shm/shared/utils/entity-id-url` |
| `OptionsDropdown`, `MenuItemType` | `@shm/ui/options-dropdown` |
| `useCopyReferenceUrl` | `@/components/copy-reference-url` (desktop only) |
| `useGatewayUrl` | `@/models/gateway-settings` (desktop only) |
| `displayHostname` | `@shm/shared/utils/entity-id-url` |

---

## 15. Edge cases

1. **Large sites**: All docs fetched upfront via `AllDescendants` (metadata only).
   Fine for hundreds-to-low-thousands. For very large sites, consider
   `react-virtuoso` (already a dep) for virtual scrolling the table rows.

2. **Citation N+1**: Each visible row calls `useInteractionSummary`. React Query
   deduplicates and caches. Collapsed rows don't render = don't fetch.

3. **Orphaned paths**: If `docs/api/endpoints` exists but `docs/api` doesn't,
   the child attaches to `docs` (nearest existing ancestor). If no ancestor
   exists, it goes to root level.

4. **Sort preserves hierarchy**: Sorting reorders siblings within their parent,
   not globally. This matches the sitemap mental model.

5. **Web SSR**: Page data fetched client-side (not SSR-prefetched). Loader still
   fetches site root for metadata. Consistent with existing directory/feed pages.

6. **TypeScript**: The `@shm/shared` package runs under desktop's tsconfig which
   doesn't enable `downlevelIteration`. Avoid `for...of` on `Map`/`Set` or
   spreading `Set`. Use `Map.forEach`, `Array.from(set)`, and `for...of` on
   arrays only.

7. **OpenInPanelButton**: `all-documents` is NOT a valid `DocumentPanelRoute`.
   Must guard with `activeView !== 'all-documents'` before rendering.

---

## 16. Verification checklist

1. Desktop: Library → hover site → click LayoutList icon → all-documents page
   opens with site header and breadcrumbs
2. Desktop: Any doc → three-dots menu → "All Documents" → navigates
3. Desktop: Omnibar shows `example.com/:all-documents` URL
4. Web: Navigate to `https://site/:all-documents` → page renders with header
5. Web: Any doc → three-dots menu → "All Documents" → navigates
6. Expand/collapse chevrons work; nested rows show visual hierarchy
7. Sort by clicking Title / Comments / Updated headers
8. Filter by typing in search input; parents auto-expand
9. Select rows → bulk action count appears
10. Citation counts lazy-load per row
11. Table stays within container (no horizontal scroll)
12. `pnpm -F @shm/shared test run all-documents-tree` — all 8 tests pass
13. `pnpm typecheck` passes
14. `pnpm format:write` passes
