# Drag Document Tool Tabs to Panel — Implementation Guide

This document describes how to implement VSCode-style drag-to-split for the document tool tabs (Content, People, Comments). Users drag any tab to the left/center to open it as the main view, or to the right to open it in the side panel. Works on desktop (Electron) + web (Remix), on both published documents and draft pages.

Reference branch: `draggable-document-tools-tabs`

---

## Architecture Overview

### Approach: Native HTML5 Drag API + React Context

- **Zero new dependencies** — HTML5 drag API works identically in Electron + browsers
- **React Context** connects drag sources (tabs in `document-tools.tsx`) to drop targets (overlay zones)
- **3 drag sources** (Content, People, Comments tabs) → **2 drop zones** (main view, panel)
- State flows: `onDragStart` → context sets `draggedTab` → overlay renders → `onDrop` → navigate → `onDragEnd` → context clears

### Data flow diagram

```
DocumentTools (drag source)
  │ onDragStart → setDraggedTab({label, mainRoute, panelRouteKey})
  │
  ▼
TabDragContext (React Context)
  │ draggedTab state shared across tree
  │
  ▼
DropZoneOverlay (drop target, delayed 100ms)
  │ onDrop → calls onDropMain or onDropPanel callback
  │
  ▼
DocumentBody / DraftPage (integration point)
  │ handleDropMain → navigate(tab.mainRoute)
  │ handleDropPanel → navigate({key:'document', id, panel:{key: tab.panelRouteKey, id}})
  │
  ▼
Route system → PanelLayout renders panel content
```

---

## Step 1: Add `content` panel route type

The "Content" tab has no existing panel equivalent. We need to add it to the route system.

### `frontend/packages/shared/src/routes.ts`

Add `contentPanelSchema` alongside the existing panel schemas (after `directoryPanelSchema`):

```ts
const contentPanelSchema = z.object({
  key: z.literal('content'),
  id: unpackedHmIdSchema.optional(),
})
```

Add it to the `documentPanelRoute` discriminated union:

```ts
const documentPanelRoute = z.discriminatedUnion('key', [
  activityRouteSchema,
  discussionsRouteSchema,
  directoryRouteSchema,
  collaboratorsRouteSchema,
  documentOptionsRouteSchema,
  contentPanelSchema, // ADD THIS
])
```

Add the `'content'` case in `createPanelRoute` switch:

```ts
case 'content':
  return {key: 'content', id: docId}
```

### `frontend/packages/shared/src/utils/entity-id-url.ts`

Add `'content'` to the `PanelQueryKey` type:

```ts
export type PanelQueryKey =
  | 'activity'
  | 'discussions'
  | 'collaborators'
  | 'directory'
  | 'options'
  | 'content' // ADD THIS
```

The existing fallthrough in `getRoutePanelParam` (`return panel.key as PanelQueryKey`) already handles `'content'` — no other changes needed in this file.

---

## Step 2: Create `TabDragContext`

### New file: `frontend/packages/ui/src/tab-drag-context.tsx`

Lightweight React Context connecting drag sources to drop targets. Tracks which tab is currently being dragged.

```tsx
import {NavRoute} from '@shm/shared'
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react'

export type DraggedTab = {
  label: string
  mainRoute: NavRoute
  panelRouteKey: string
}

type TabDragContextValue = {
  draggedTab: DraggedTab | null
  setDraggedTab: (tab: DraggedTab | null) => void
}

const TabDragContext = createContext<TabDragContextValue>({
  draggedTab: null,
  setDraggedTab: () => {},
})

export function TabDragProvider({children}: {children: ReactNode}) {
  const [draggedTab, setDraggedTabState] = useState<DraggedTab | null>(null)
  const setDraggedTab = useCallback((tab: DraggedTab | null) => {
    setDraggedTabState(tab)
  }, [])
  return (
    <TabDragContext.Provider value={{draggedTab, setDraggedTab}}>
      {children}
    </TabDragContext.Provider>
  )
}

export function useTabDrag() {
  return useContext(TabDragContext)
}
```

---

## Step 3: Create `DropZoneOverlay`

### New file: `frontend/packages/ui/src/drop-zone-overlay.tsx`

Absolute overlay with left/right drop zones. Shown during drag.

**CRITICAL**: Uses a 100ms delayed visibility to prevent drag cancellation. See [Gotcha #1](#gotcha-1-drag-cancellation-from-overlay-rendering) below.

```tsx
import {useEffect, useRef, useState} from 'react'
import {DraggedTab, useTabDrag} from './tab-drag-context'
import {cn} from './utils'

type DropZone = 'main' | 'panel'

export function DropZoneOverlay({
  onDropMain,
  onDropPanel,
}: {
  onDropMain: (tab: DraggedTab) => void
  onDropPanel: (tab: DraggedTab) => void
}) {
  const {draggedTab} = useTabDrag()
  const [activeZone, setActiveZone] = useState<DropZone | null>(null)
  const [visible, setVisible] = useState(false)
  const draggedTabRef = useRef(draggedTab)
  draggedTabRef.current = draggedTab

  // Delay showing the overlay so it doesn't appear on top of the drag source
  // and cancel the drag operation
  useEffect(() => {
    if (draggedTab) {
      const timer = setTimeout(() => setVisible(true), 100)
      return () => clearTimeout(timer)
    } else {
      setVisible(false)
      setActiveZone(null)
    }
  }, [draggedTab])

  if (!visible || !draggedTab) return null

  const handleDragOver = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setActiveZone(zone)
  }

  const handleDrop = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault()
    setActiveZone(null)
    const tab = draggedTabRef.current
    if (!tab) return
    if (zone === 'main') onDropMain(tab)
    else onDropPanel(tab)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex gap-1 p-1">
      {/* Left/center zone: open as main view */}
      <div
        className={cn(
          'pointer-events-auto flex flex-1 items-center justify-center rounded-lg border-2 border-dashed transition-colors',
          activeZone === 'main'
            ? 'border-blue-400 bg-blue-500/10 dark:bg-blue-400/10'
            : 'border-transparent',
        )}
        onDragOver={(e) => handleDragOver(e, 'main')}
        onDragLeave={() => setActiveZone(null)}
        onDrop={(e) => handleDrop(e, 'main')}
      >
        {activeZone === 'main' && (
          <span className="pointer-events-none text-sm font-medium text-blue-600 select-none dark:text-blue-400">
            Open as main view
          </span>
        )}
      </div>

      {/* Right zone: open in panel */}
      <div
        className={cn(
          'pointer-events-auto flex w-[30%] min-w-[120px] items-center justify-center rounded-lg border-2 border-dashed transition-colors',
          activeZone === 'panel'
            ? 'border-blue-400 bg-blue-500/10 dark:bg-blue-400/10'
            : 'border-muted-foreground/30',
        )}
        onDragOver={(e) => handleDragOver(e, 'panel')}
        onDragLeave={() => setActiveZone(null)}
        onDrop={(e) => handleDrop(e, 'panel')}
      >
        <span
          className={cn(
            'pointer-events-none text-sm font-medium select-none',
            activeZone === 'panel'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-muted-foreground/50',
          )}
        >
          Open in panel
        </span>
      </div>
    </div>
  )
}
```

Key design decisions:
- **Outer div**: `pointer-events-none` so the overlay doesn't block interaction
- **Inner zones**: `pointer-events-auto` so they receive drag events
- **Left zone**: `flex-1` (~70%), border transparent until hovered
- **Right zone**: `w-[30%]`, always shows faint "Open in panel" text
- **`draggedTabRef`**: ref to avoid stale closure in `handleDrop`

---

## Step 4: Create `ContentPanel`

### New file: `frontend/packages/ui/src/content-panel.tsx`

Read-only document content for the panel. Shows the published version.

```tsx
import {UnpackedHypermediaId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {BlocksContent, BlocksContentProvider} from './blocks-content'
import {Spinner} from './spinner'

export function ContentPanel({docId}: {docId: UnpackedHypermediaId}) {
  const resource = useResource(docId)

  if (resource.isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner />
      </div>
    )
  }

  if (!resource.data || resource.data.type !== 'document') {
    return <div className="text-muted-foreground p-4">No content available</div>
  }

  const document = resource.data.document

  return (
    <div className="p-2">
      <BlocksContentProvider resourceId={docId}>
        <BlocksContent blocks={document.content} />
      </BlocksContentProvider>
    </div>
  )
}
```

---

## Step 5: Make `ToolLink` draggable in `document-tools.tsx`

### Modify: `frontend/packages/ui/src/document-tools.tsx`

#### 5a. Add imports

```ts
import {DraggedTab, useTabDrag} from './tab-drag-context'
```

#### 5b. Add `dragData` to buttons array

Each button in the `buttons` array gets a `dragData` property:

```ts
const buttons: {
  label: string
  tooltip: string
  icon: IconComponent
  count?: number
  active: boolean
  route: NavRoute
  bg?: string
  dragData?: DraggedTab  // ADD THIS TYPE
}[] = [
  {
    label: 'Content',
    tooltip: existingDraft ? 'Resume Editing' : 'Open Content',
    icon: Newspaper,
    active: activeTab == 'draft' || activeTab == 'content',
    route: contentMainRoute,
    dragData: {
      label: 'Content',
      mainRoute: contentMainRoute,
      panelRouteKey: 'content',
    },
  },
  {
    label: 'People',
    tooltip: 'Open Document Collaborators',
    icon: Users,
    active: activeTab == 'collaborators',
    count: collabsCount,
    route: {key: 'collaborators', id: idWithoutBlock, panel: panelFor()},
    dragData: {
      label: 'People',
      mainRoute: {key: 'collaborators', id: idWithoutBlock, panel: panelFor()},
      panelRouteKey: 'collaborators',
    },
  },
  {
    label: 'Comments',
    tooltip: 'Open Document Comments',
    icon: MessageSquare,
    active: activeTab == 'discussions',
    count: commentsCount,
    route: {key: 'discussions', id: idWithoutBlock, panel: panelFor()},
    dragData: {
      label: 'Comments',
      mainRoute: {key: 'discussions', id: idWithoutBlock, panel: panelFor()},
      panelRouteKey: 'discussions',
    },
  },
]
```

#### 5c. Pass `dragData` to `ToolLink`

In the visible buttons map (NOT the hidden measurement container):

```tsx
<ToolLink
  key={button.label}
  active={button.active}
  route={button.route}
  label={button.label}
  tooltip={button.tooltip}
  icon={button.icon}
  count={button.count}
  bg={button.bg}
  showLabel={showLabels}
  dragData={button.dragData}  // ADD THIS
/>
```

#### 5d. Modify `ToolLink` to support dragging

**CRITICAL**: Use `<Button>` directly (renders as `<button>` element), NOT `<Button asChild><a>`. See [Gotcha #2](#gotcha-2-a-elements-interfere-with-draggable) below.

```tsx
function ToolLink({
  route,
  label,
  tooltip,
  count,
  icon: Icon,
  active = false,
  showLabel = true,
  bg,
  dragData,           // ADD THIS PROP
}: ButtonProps & {
  route: NavRoute
  label?: string
  count?: number
  icon: any
  tooltip?: string
  active?: boolean
  showLabel?: boolean
  bg?: string
  dragData?: DraggedTab  // ADD THIS TYPE
}) {
  const linkProps = useRouteLink(route)
  const {setDraggedTab} = useTabDrag()   // ADD THIS

  const handleDragStart = useCallback(   // ADD THIS
    (e: React.DragEvent) => {
      if (!dragData) return
      e.dataTransfer.setData('text/plain', dragData.label)
      e.dataTransfer.effectAllowed = 'move'
      setDraggedTab(dragData)
    },
    [dragData, setDraggedTab],
  )

  const handleDragEnd = useCallback(() => {  // ADD THIS
    setDraggedTab(null)
  }, [setDraggedTab])

  let btn = (
    <Button
      variant={active ? 'accent' : 'ghost'}
      onClick={linkProps.onClick}       // Use onClick from useRouteLink
      draggable={!!dragData}            // ADD THIS
      onDragStart={handleDragStart}     // ADD THIS
      onDragEnd={handleDragEnd}         // ADD THIS
    >
      <Icon className="size-4" />
      {label && showLabel ? (
        <span className="hidden truncate text-sm md:block">{label}</span>
      ) : null}
      {count ? <span className="text-sm">{count}</span> : null}
    </Button>
  )
  return <Tooltip content={active ? '' : tooltip || ''}>{btn}</Tooltip>
}
```

---

## Step 6: Update panel title

### Modify: `frontend/packages/ui/src/panel-layout.tsx`

In `getPanelTitle`, add the `'content'` case:

```ts
function getPanelTitle(panelKey: PanelSelectionOptions | null): string {
  switch (panelKey) {
    case 'activity':
      return 'Document Activity'
    case 'discussions':
      return 'Discussions'
    case 'directory':
      return 'Directory'
    case 'collaborators':
      return 'Collaborators'
    case 'options':
      return 'Draft Options'
    case 'content':       // ADD THIS
      return 'Content'    // ADD THIS
    default:
      return ''
  }
}
```

---

## Step 7: Integrate into published doc view (`resource-page-common.tsx`)

### Modify: `frontend/packages/ui/src/resource-page-common.tsx`

#### 7a. Add imports

```ts
import {ContentPanel} from './content-panel'
import {DropZoneOverlay} from './drop-zone-overlay'
import {DraggedTab, TabDragProvider} from './tab-drag-context'
```

#### 7b. Add drop handlers in `DocumentBody`

Before the return statement in `DocumentBody` (desktop branch), add:

```ts
const handleDropMain = useCallback(
  (tab: DraggedTab) => {
    navigate(tab.mainRoute)
  },
  [navigate],
)

const handleDropPanel = useCallback(
  (tab: DraggedTab) => {
    navigate({
      key: 'document',
      id: docId,
      panel: {key: tab.panelRouteKey, id: docId} as DocumentPanelRoute,
    })
  },
  [navigate, docId],
)
```

**Note**: `handleDropPanel` navigates to an explicit `{key: 'document', id, panel}` route instead of spreading the current route. This avoids TypeScript errors from the discriminated union type — see [Gotcha #3](#gotcha-3-typescript-error-with-route-spreading).

#### 7c. Wrap with `TabDragProvider` and add `DropZoneOverlay`

```tsx
return (
  <TabDragProvider>
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      ref={elementRef}
    >
      <DropZoneOverlay
        onDropMain={handleDropMain}
        onDropPanel={handleDropPanel}
      />
      <PanelLayout
        panelKey={panelKey}
        panelContent={panelContent}
        onPanelClose={handlePanelClose}
        {/* ... rest of existing props */}
      >
        {/* ... existing children */}
      </PanelLayout>
    </div>
  </TabDragProvider>
)
```

The container div MUST have `relative` class for the absolute overlay to position correctly.

#### 7d. Add `'content'` case to `PanelContentRenderer`

```tsx
case 'content':
  return <ContentPanel docId={docId} />
```

---

## Step 8: Integrate into draft page (`draft.tsx`)

### Modify: `frontend/apps/desktop/src/pages/draft.tsx`

Same pattern as resource-page-common.tsx:

#### 8a. Add imports

```ts
import {ContentPanel} from '@shm/ui/content-panel'
import {DropZoneOverlay} from '@shm/ui/drop-zone-overlay'
import {DraggedTab, TabDragProvider} from '@shm/ui/tab-drag-context'
```

#### 8b. Add drop handlers

```ts
const handleDropMain = useCallback(
  (tab: DraggedTab) => {
    replace(tab.mainRoute)
  },
  [replace],
)

const handleDropPanel = useCallback(
  (tab: DraggedTab) => {
    const panelId = editId || locationId
    if (panelId) {
      replace({
        ...route,
        panel: {
          key: tab.panelRouteKey,
          id: panelId,
        } as DocumentPanelRoute,
      })
    }
  },
  [replace, route, editId, locationId],
)
```

Note: draft page uses `replace` instead of `navigate`, and `editId || locationId` for the panel doc ID.

#### 8c. Wrap with `TabDragProvider` and add `DropZoneOverlay`

```tsx
<TabDragProvider>
  <div
    className={cn(
      panelContainerStyles,
      'dark:bg-background relative flex h-full flex-col bg-white',
    )}
  >
    {/* existing header */}
    <DropZoneOverlay
      onDropMain={handleDropMain}
      onDropPanel={handleDropPanel}
    />
    <PanelLayout ...>
      {/* existing content */}
    </PanelLayout>
  </div>
</TabDragProvider>
```

Container must have `relative` class.

#### 8d. Add `'content'` case to `DraftPanelContent`

```tsx
case 'content':
  return docId ? <ContentPanel docId={docId} /> : null
```

---

## Route Construction on Drop

| Tab | Drop on Main | Drop on Panel |
|-----|-------------|---------------|
| Content | Navigate to doc/draft route | `{key: 'document', id, panel: {key: 'content', id}}` |
| People | `{key: 'collaborators', id, panel: currentPanel}` | `{key: 'document', id, panel: {key: 'collaborators', id}}` |
| Comments | `{key: 'discussions', id, panel: currentPanel}` | `{key: 'document', id, panel: {key: 'discussions', id}}` |

---

## Tests

### Add to: `frontend/packages/shared/src/__tests__/routes.test.ts`

```ts
describe('content panel', () => {
  test('content panel param creates content panel route', () => {
    const route = createDocumentNavRoute(testDocId, null, 'content')
    expect(route).toEqual({
      key: 'document',
      id: testDocId,
      panel: {key: 'content', id: testDocId},
    })
  })

  test('content panel preserves docId path', () => {
    const docWithPath = hmId('testuid123', {path: ['docs', 'page']})
    const route = createDocumentNavRoute(docWithPath, null, 'content')
    expect(route).toEqual({
      key: 'document',
      id: docWithPath,
      panel: {key: 'content', id: docWithPath},
    })
  })
})

describe('getRoutePanel', () => {
  test('extracts content panel from document route', () => {
    const route = createDocumentNavRoute(testDocId, null, 'content')
    const panel = getRoutePanel(route)
    expect(panel).toEqual({key: 'content', id: testDocId})
  })

  // ... also test activity, discussions, collaborators, directory extraction
  // ... test that no-panel returns null
})

describe('getRoutePanelParam', () => {
  test('serializes content panel to "content"', () => {
    const route = createDocumentNavRoute(testDocId, null, 'content')
    expect(getRoutePanelParam(route)).toBe('content')
  })

  test('content panel round-trips through URL param', () => {
    const route = createDocumentNavRoute(testDocId, null, 'content')
    const param = getRoutePanelParam(route)
    expect(param).toBe('content')
    const roundTripped = createDocumentNavRoute(testDocId, null, param)
    expect(roundTripped).toEqual(route)
  })

  // ... test other panels round-trip, null case, etc.
})
```

---

## Gotchas & Lessons Learned

### Gotcha 1: Drag cancellation from overlay rendering

**Problem**: When `onDragStart` fires, it sets `draggedTab` in context, which causes `DropZoneOverlay` to render immediately. The overlay appears on top of the drag source **in the same frame**, causing the browser to lose the drag source reference and fire `onDragEnd` immediately (drag starts and cancels instantly).

**Symptoms**: `onDragStart` fires, then `onDragEnd` fires within milliseconds. The drag ghost never appears.

**Solution**: Add a `visible` state with 100ms delay via `useEffect`/`setTimeout`. The overlay doesn't render until 100ms after drag starts, giving the browser time to fully establish the drag operation.

```tsx
useEffect(() => {
  if (draggedTab) {
    const timer = setTimeout(() => setVisible(true), 100)
    return () => clearTimeout(timer)
  } else {
    setVisible(false)
    setActiveZone(null)
  }
}, [draggedTab])

if (!visible || !draggedTab) return null
```

### Gotcha 2: `<a>` elements interfere with `draggable`

**Problem**: The original `ToolLink` used `<Button asChild><a href={...}>` (Radix's Slot pattern). Native `<a>` elements are **inherently draggable** by browsers (to allow link dragging). This native drag behavior competes with the explicit `draggable` attribute, and Radix's `Slot`/`TooltipTrigger` event handlers may also intercept drag events.

**Symptoms**: Dragging shows a link-drag ghost (URL text) instead of the custom drag behavior, or drag events don't fire at all.

**Solution**: Remove `asChild`/`<a>` pattern entirely. Use plain `<Button>` (renders as `<button>` element) with `onClick={linkProps.onClick}`. The `<button>` element is NOT natively draggable, so the explicit `draggable` attribute works correctly. Navigation still works via `linkProps.onClick` from `useRouteLink`.

### Gotcha 3: TypeScript error with route spreading

**Problem**: Spreading `{...route, panel: newPanel}` causes TypeScript errors because the `NavRoute` discriminated union can't be narrowed when you spread and override. The resulting type doesn't match any specific union member.

**Solution**: Navigate to an explicit route object instead of spreading:

```ts
// BAD - TypeScript error
navigate({...route, panel: {key: tab.panelRouteKey, id: docId}})

// GOOD - explicit route
navigate({
  key: 'document',
  id: docId,
  panel: {key: tab.panelRouteKey, id: docId} as DocumentPanelRoute,
})
```

---

## Edge Cases

- **Drag cancelled** (dropped outside zones): `onDragEnd` fires → `setDraggedTab(null)` → overlay disappears, no navigation
- **Tab already active**: navigating to same route is a no-op, harmless
- **Mobile**: overlay doesn't render (panels not supported on mobile), tabs work as click-only
- **Content in panel on draft page**: shows published version via `useResource`; if unpublished, shows "No content available"
- **Click navigation preserved**: HTML5 drag only starts after pointer movement threshold, so regular clicks still navigate normally

---

## Verification Checklist

1. `pnpm -F @shm/shared build:types` — confirm new `content` panel type compiles
2. `pnpm typecheck` — no type errors across workspaces
3. `pnpm format:write` — formatting
4. `pnpm -F @shm/shared test run` — route tests pass
5. Manual test on desktop: drag each tab to both zones on published doc + draft
6. Manual test on web: same drag interactions
7. Verify click navigation still works (no regression from `draggable` attr)
8. Verify `?panel=content` URL param round-trips correctly
