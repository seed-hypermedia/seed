# Phase 3: Panel System Migration

## Objective
Unify panel system using existing route-based architecture. No new types needed - use `NavRoute.panel` and `DocumentPanelRoute` from `@shm/shared/routes.ts`.

## Pre-Conditions
- Phase 1 complete: Basic document rendering works
- Phase 2 complete: View term routing works

## Key Insight: Unify Navigation

Currently there are TWO navigation hooks that do similar things:
- `useNavigate()` in `navigation.tsx` - just dispatches to nav state (broken on web - no URL sync)
- `useOpenRoute()` in `routing.tsx` - uses `openRoute` from context (works on both platforms)

**Solution**: Fix `useNavigate()` to use `openRoute` from context, then delete `useOpenRoute()`.

After this change:
- `useNavigate()` works correctly on both platforms
- Web: dispatches to nav state AND syncs browser URL
- Desktop: dispatches to nav state
- Single hook to use everywhere

---

## Provider Architecture Cleanup

### Current State (Messy)
Web has multiple overlapping providers:
- `WebSiteProvider` - sets up navigation + UniversalAppProvider
- `Providers` - QueryClient + Theme
- Various contexts scattered

### Target State (Clean)
Single unified provider pattern on web that provides:
- Navigation (with URL sync)
- Current account ID (from `useLocalKeyPair()`)
- Query client (hydrated from SSR)
- Theme

**Note**: `currentAccountId` is available via `useLocalKeyPair()?.id` on web. We can expose this in a shared context.

---

## Implementation Steps

### Step 3.0: Unify Navigation Hooks (DO THIS FIRST)

Fix `useNavigate()` to use `openRoute` from `UniversalAppContext`, then delete `useOpenRoute()`.

**File**: `frontend/packages/shared/src/utils/navigation.tsx`

```typescript
// BEFORE (broken on web - no URL sync):
export function useNavigate() {
  const dispatch = useNavigationDispatch()
  return (route: NavRoute) => {
    dispatch({type: 'push', route})
  }
}

// AFTER (works on both platforms):
import { useContext } from 'react'
import { UniversalAppContext } from '../routing'

export function useNavigate(mode: 'push' | 'replace' = 'push') {
  const context = useContext(UniversalAppContext)
  const dispatch = useNavigationDispatch()

  return (route: NavRoute) => {
    // Use openRoute from context if available (handles URL sync on web)
    if (context?.openRoute) {
      context.openRoute(route, mode === 'replace')
    } else {
      // Fallback to direct dispatch (shouldn't happen in normal usage)
      dispatch({ type: mode, route })
    }
  }
}

// Delete useReplace() - useNavigate('replace') handles this
```

**File**: `frontend/packages/shared/src/routing.tsx`

```typescript
// DELETE this function:
export function useOpenRoute() {
  const context = useContext(UniversalAppContext)
  if (!context)
    throw new Error('useOpenRoute must be used in a UniversalRoutingProvider')
  const openRoute = context.openRoute
  if (!openRoute) {
    throw new Error(
      'No openRoute function in UniversalAppContext. Cannot open route',
    )
  }
  return (route: NavRoute) => {
    openRoute(route)
  }
}
```

**Migration**: Find and replace all usages:

| Old | New |
|-----|-----|
| `useOpenRoute()` | `useNavigate()` |
| `useReplace()` | `useNavigate('replace')` |
| `openRoute(route)` | `navigate(route)` |
| `openRoute(route, true)` | `navigateReplace(route)` where `navigateReplace = useNavigate('replace')` |

**Files to update** (current usages of `useOpenRoute`):

| File | Line | Change |
|------|------|--------|
| `shared/src/routing.tsx` | 142 | Delete `useOpenRoute()` function |
| `ui/src/comments.tsx` | 20, 862 | Import `useNavigate`, replace `useOpenRoute()` |
| `ui/src/blocks-content.tsx` | 42, 2013 | Import `useNavigate`, replace `useOpenRoute()` |
| `ui/src/embed-wrapper.tsx` | 1, 32 | Import `useNavigate`, replace `useOpenRoute()` |

Also update the exports in `shared/src/index.ts` if `useOpenRoute` is exported there.

---

### Step 3.1: Create Shared Panel Hook

**File**: `frontend/packages/ui/src/use-panel.ts`

This hook works on BOTH platforms using the unified `useNavigate()`:

```typescript
import { useCallback, useMemo } from 'react'
import {
  DocumentPanelRoute,
  NavRoute,
  PanelSelectionOptions,
  getRoutePanel,
} from '@shm/shared/routes'
import { useNavRoute, useNavigate } from '@shm/shared/utils/navigation'
import { UnpackedHypermediaId } from '@shm/shared'

export interface PanelActions {
  /** Current panel key (null if closed) */
  panelKey: PanelSelectionOptions | null
  /** Full panel route data */
  panelRoute: DocumentPanelRoute | null
  /** Open a specific panel */
  openPanel: (panel: DocumentPanelRoute) => void
  /** Close the panel */
  closePanel: () => void
  /** Toggle panel (close if same key, open otherwise) */
  togglePanel: (key: PanelSelectionOptions) => void
}

/**
 * Shared panel state hook. Works on both web and desktop.
 * Uses useNavigate('replace') which handles URL sync on web automatically.
 *
 * @param docId - Document ID (used when opening panels that need it)
 */
export function usePanelState(docId?: UnpackedHypermediaId): PanelActions {
  const route = useNavRoute()
  const navigate = useNavigate('replace')  // Replace to avoid adding to history

  // Extract panel from current route
  const panelRoute = useMemo(() => {
    if (!route) return null
    return getRoutePanel(route) as DocumentPanelRoute | null
  }, [route])

  const panelKey = panelRoute?.key ?? null

  const openPanel = useCallback((panel: DocumentPanelRoute) => {
    if (!route) return
    if ('panel' in route) {
      navigate({ ...route, panel } as NavRoute)
    }
  }, [route, navigate])

  const closePanel = useCallback(() => {
    if (!route) return
    if ('panel' in route) {
      navigate({ ...route, panel: null } as NavRoute)
    }
  }, [route, navigate])

  const togglePanel = useCallback((key: PanelSelectionOptions) => {
    if (panelKey === key) {
      closePanel()
    } else {
      // Create minimal panel route with just key and id
      const newPanel: DocumentPanelRoute = docId
        ? { key, id: docId } as DocumentPanelRoute
        : { key } as DocumentPanelRoute
      openPanel(newPanel)
    }
  }, [panelKey, docId, openPanel, closePanel])

  return {
    panelKey,
    panelRoute,
    openPanel,
    closePanel,
    togglePanel,
  }
}
```

### Step 3.2: Create Shared Panel Layout Component

**File**: `frontend/packages/ui/src/panel-layout.tsx`

Single layout component that works on both platforms:

```typescript
import { useRef, useLayoutEffect } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels'
import { PanelSelectionOptions } from '@shm/shared/routes'
import { useTx } from '@shm/shared/translation'
import { Button } from '@shm/ui/button'
import { panelContainerStyles } from '@shm/ui/container'
import { Text } from '@shm/ui/text'
import { cn } from '@shm/ui/utils'
import { X } from 'lucide-react'

export interface PanelLayoutProps {
  children: React.ReactNode
  panelContent: React.ReactNode | null
  panelKey: PanelSelectionOptions | null
  onPanelClose: () => void
  /** Optional: custom panel header content (e.g., FeedFilters) */
  panelHeaderExtra?: React.ReactNode
  /** Storage for panel width persistence */
  widthStorage?: {
    getItem: (name: string) => string
    setItem: (name: string, value: string) => void
  }
}

function getPanelTitle(panelKey: PanelSelectionOptions | null, tx: (key: string) => string): string {
  switch (panelKey) {
    case 'activity': return tx('Document Activity')
    case 'discussions': return tx('Discussions')
    case 'directory': return tx('Directory')
    case 'collaborators': return tx('Collaborators')
    case 'options': return tx('Draft Options')
    default: return ''
  }
}

export function PanelLayout({
  children,
  panelContent,
  panelKey,
  onPanelClose,
  panelHeaderExtra,
  widthStorage,
}: PanelLayoutProps) {
  const tx = useTx()
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<ImperativePanelHandle>(null)

  // Enforce 480px minimum when panel opens
  useLayoutEffect(() => {
    if (!panelKey || !containerRef.current || !panelRef.current) return

    const containerWidth = containerRef.current.getBoundingClientRect().width
    if (!containerWidth) return

    const minPercent = (480 / containerWidth) * 100
    const currentSize = panelRef.current.getSize()

    if (currentSize < minPercent) {
      panelRef.current.resize(Math.min(50, minPercent))
    }
  }, [panelKey])

  const title = getPanelTitle(panelKey, tx)

  return (
    <div ref={containerRef} className="flex h-full flex-1">
      <PanelGroup
        direction="horizontal"
        autoSaveId="resource-panel"
        storage={widthStorage}
        style={{ flex: 1 }}
      >
        <Panel id="main" minSize={50} className="p-0.5 pr-1">
          <div className="h-full rounded-lg">{children}</div>
        </Panel>

        {panelKey && (
          <>
            <PanelResizeHandle className="panel-resize-handle" />
            <Panel
              ref={panelRef}
              id="accessory"
              minSize={20}
              maxSize={50}
              defaultSize={30}
              className="p-0.5 pl-1"
            >
              <div className="h-full rounded-lg">
                <div className={cn(panelContainerStyles, 'dark:bg-background flex flex-col bg-white')}>
                  <div className="border-border border-b px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Text weight="semibold" size="lg" className="flex-1">
                        {title}
                      </Text>
                      <Button size="icon" onClick={onPanelClose}>
                        <X className="size-4" />
                      </Button>
                    </div>
                    {panelHeaderExtra}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    {panelContent}
                  </div>
                </div>
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}
```

### Step 3.3: Create Shared Panel Content Component

**File**: `frontend/packages/ui/src/panel-content.tsx`

Renders the appropriate panel based on key:

```typescript
import { Suspense, lazy } from 'react'
import { DocumentPanelRoute } from '@shm/shared/routes'
import { UnpackedHypermediaId } from '@shm/shared'
import { Spinner } from '@shm/ui/spinner'

const Feed = lazy(() => import('@shm/ui/feed').then(m => ({ default: m.Feed })))
const DiscussionsPanel = lazy(() => import('@shm/ui/discussions-page').then(m => ({ default: m.DiscussionsPageContent })))
const DirectoryPanel = lazy(() => import('@shm/ui/directory-panel').then(m => ({ default: m.DirectoryPanel })))
const CollaboratorsPanel = lazy(() => import('@shm/ui/collaborators-page').then(m => ({ default: m.CollaboratorsPageContent })))

export interface PanelContentProps {
  panel: DocumentPanelRoute
  docId: UnpackedHypermediaId
  currentAccountId?: string
  /** Comment editor component (platform-specific) */
  commentEditor?: React.ReactNode
}

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <Spinner />
    </div>
  )
}

export function PanelContent({ panel, docId, currentAccountId, commentEditor }: PanelContentProps) {
  return (
    <Suspense fallback={<PanelLoading />}>
      {panel.key === 'activity' && (
        <Feed
          filterResource={docId.id}
          currentAccount={currentAccountId}
          filterEventType={panel.filterEventType || []}
        />
      )}
      {panel.key === 'discussions' && (
        <DiscussionsPanel
          docId={docId}
          openComment={panel.openComment}
          commentEditor={commentEditor}
          currentAccountId={currentAccountId}
          showOpenInPanel={false}
          showTitle={false}
        />
      )}
      {panel.key === 'directory' && (
        <DirectoryPanel docId={docId} />
      )}
      {panel.key === 'collaborators' && (
        <CollaboratorsPanel docId={docId} showOpenInPanel={false} showTitle={false}>
          {/* ReadOnlyCollaboratorsContent is web-specific, handle in wrapper */}
        </CollaboratorsPanel>
      )}
    </Suspense>
  )
}
```

### Step 3.4: Integrate into ResourcePageCommon

Update the shared resource page to use panel components:

```typescript
// In resource-page-common.tsx

import { PanelLayout } from '@shm/ui/panel-layout'
import { PanelContent } from '@shm/ui/panel-content'
import { usePanelState } from '@shm/ui/use-panel'
import { FeedFilters } from '@shm/ui/feed-filters'

export function ResourcePageCommon({
  docId,
  widthStorage,  // Platform-specific width storage (optional)
  commentEditor,  // Platform-specific comment editor
  currentAccountId,
  // ... other props
}: ResourcePageCommonProps) {
  // No navigate prop needed - usePanelState uses useNavigate() internally
  const { panelKey, panelRoute, closePanel, openPanel } = usePanelState(docId)

  const panelContent = panelRoute ? (
    <PanelContent
      panel={panelRoute}
      docId={docId}
      currentAccountId={currentAccountId}
      commentEditor={commentEditor}
    />
  ) : null

  // Feed filters for activity panel
  const panelHeaderExtra = panelKey === 'activity' && panelRoute?.key === 'activity' ? (
    <FeedFilters
      filterEventType={panelRoute.filterEventType}
      onFilterChange={({ filterEventType }) => {
        openPanel({ ...panelRoute, filterEventType })
      }}
    />
  ) : null

  return (
    <PanelLayout
      panelKey={panelKey}
      panelContent={panelContent}
      onPanelClose={closePanel}
      panelHeaderExtra={panelHeaderExtra}
      widthStorage={widthStorage}
    >
      {/* Main content */}
      <MainPageContent docId={docId} />
    </PanelLayout>
  )
}
```

### Step 3.5: Desktop Integration

Desktop wrapper adds keyboard shortcuts (panel hook needs no special setup):

```typescript
// In desktop-resource.tsx

import { useListenAppEvent } from '@/utils/window-events'
import { usePanelState } from '@shm/ui/use-panel'
import { useNavigate } from '@shm/shared/utils/navigation'

export function DesktopResourcePage({ docId }: { docId: UnpackedHypermediaId }) {
  const navigate = useNavigate()  // Uses unified hook from @shm/shared

  // Desktop-specific: keyboard shortcuts navigate between primary views
  // (This is separate from panels - these change the MAIN content area)
  useListenAppEvent('toggle_tool', (event) => {
    // Cmd+1: Document content, Cmd+2: Activity, Cmd+3: Discussions, etc.
    const viewRoutes = [
      { key: 'document', id: docId },  // index 0: content
      { key: 'activity', id: docId },  // index 1
      { key: 'discussions', id: docId },  // index 2
      { key: 'directory', id: docId },  // index 3
      { key: 'collaborators', id: docId },  // index 4
    ] as const
    const targetRoute = viewRoutes[event.index]
    if (targetRoute) navigate(targetRoute as NavRoute)
  })

  // Width storage from navigation state
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()
  const widthStorage = useMemo(() => ({
    getItem: () => String(state?.accessoryWidth || 0),
    setItem: (_, value: string) => {
      const data = JSON.parse(value)
      const width = data['resource-panel']?.layout[1]
      if (typeof width === 'number') {
        dispatch({ type: 'accessoryWidth', value: width })
      }
    },
  }), [state?.accessoryWidth, dispatch])

  return (
    <ResourcePageCommon
      docId={docId}
      widthStorage={widthStorage}
      // ... platform-specific props
    />
  )
}
```

### Step 3.6: Web Integration

Web wrapper is simple - `useNavigate()` handles URL sync via `WebSiteProvider`:

```typescript
// In resource-web.tsx

export function WebResourcePage({ docId }: { docId: UnpackedHypermediaId }) {
  // No custom navigate wrapper needed!
  // useNavigate() in usePanelState() automatically syncs with browser URL
  // because WebSiteProvider's openRoute calls routeToHref() + Remix navigate()

  // LocalStorage-based width - PanelGroup handles this with autoSaveId

  return (
    <ResourcePageCommon
      docId={docId}
      // No navigate or widthStorage needed
      // - usePanelState() uses useNavigate() internally
      // - PanelGroup autoSaveId handles width persistence
      // ... platform-specific props (commentEditor, etc.)
    />
  )
}
```

---

## URL Sync Details

The URL stays in sync automatically via unified `useNavigate()`:

1. **usePanelState** calls `useNavigate('replace')` from `@shm/shared/utils/navigation.tsx`
2. **useNavigate** uses `openRoute` from `UniversalAppContext`
3. **WebSiteProvider** sets `openRoute` to:
   - Call `routeToHref(route, context)` to get URL
   - Call Remix `navigate(href)` to update browser URL
4. **routeToHref** uses `getRoutePanelParam(route)` → extracts panel key
5. **createWebHMUrl** adds `?panel=activity` to URL

On page load:
1. Remix loader parses `?panel=` from URL
2. Creates initial route with panel
3. `usePanelState()` reads panel from route

---

## Testing Checklist

### Both Platforms
- [ ] Panel opens when clicking "Open in Panel" buttons
- [ ] Panel shows correct content (activity/discussions/directory/collaborators)
- [ ] Panel closes when clicking X button
- [ ] Panel toggles (close if same key clicked)
- [ ] Panel width is resizable
- [ ] Panel width persists after close/reopen
- [ ] Panel respects 480px minimum width
- [ ] Can have panel open with any main view (activity + discussions panel, etc.)

### Desktop-Specific
- [ ] Keyboard shortcuts navigate between views (Cmd+1=content, Cmd+2=activity, Cmd+3=discussions, Cmd+4=directory, Cmd+5=collaborators)
- [ ] Panel width stored in navigation state

### Web-Specific
- [ ] URL updates with `?panel=key` when panel opens
- [ ] URL removes `?panel=` when panel closes
- [ ] Direct URL with `?panel=activity` opens activity panel
- [ ] Width stored in localStorage

### Cross-Platform Consistency
- [ ] Same panel keys work on both platforms
- [ ] Panel content renders identically
- [ ] Panel interactions feel similar

---

## Files Created/Modified

### Step 3.0: Navigation Unification
| File | Type | Purpose |
|------|------|---------|
| `shared/src/utils/navigation.tsx` | Modified | Fix `useNavigate()` to use `openRoute` from context |
| `shared/src/routing.tsx` | Modified | Delete `useOpenRoute()` |
| Various files | Modified | Migrate `useOpenRoute` → `useNavigate` |

### Steps 3.1-3.6: Panel System
| File | Type | Purpose |
|------|------|---------|
| `ui/src/use-panel.ts` | New | Shared panel state hook (uses `useNavigate()`) |
| `ui/src/panel-layout.tsx` | New | Shared panel layout component |
| `ui/src/panel-content.tsx` | New | Shared panel content renderer |
| `ui/src/resource-page-common.tsx` | Modified | Integrate panel components |
| `desktop/src/pages/desktop-resource.tsx` | Modified | Add `toggle_tool` keyboard shortcuts |
| `web/app/resource-web.tsx` | Modified | Minimal - just pass docId |

**Key insight**: After Step 3.0, `useNavigate()` works correctly on both platforms:
- Web: Uses `openRoute` from context → Remix navigation + URL sync
- Desktop: Uses `openRoute` from context → dispatches to navigation state

---

## Current Account ID

Both platforms have access to current account:

| Platform | How to get currentAccountId |
|----------|----------------------------|
| Web | `useLocalKeyPair()?.id` from `auth.tsx` |
| Desktop | `selectedIdentity` from navigation state |

Future: Consider unifying into `useCurrentAccountId()` hook in shared code.

---

## Desktop Event Rename: toggle_accessory → toggle_tool

The keyboard shortcut event needs renaming and behavior change:

**Old behavior**: `toggle_accessory` toggled side panels
**New behavior**: `toggle_tool` navigates between primary view routes

Files to update:

| File | Change |
|------|--------|
| `desktop/src/utils/window-events.ts` | Rename type `toggle_accessory` → `toggle_tool` |
| `desktop/src/app-windows.ts` | Update dispatch to use `toggle_tool` |
| `desktop/src/pages/draft.tsx` | Update listener to use new behavior |
| `desktop/src/pages/desktop-legacy-document.tsx` | Update listener (until migrated) |
| `desktop/src/utils/__tests__/window-events.test.ts` | Update tests |
| `docs/docs/keyboard-shortcuts-accessory-panel-plan.md` | Update documentation |

The shortcut mapping becomes:
- **Cmd+1**: Document content (route key: `document`)
- **Cmd+2**: Activity (route key: `activity`)
- **Cmd+3**: Discussions (route key: `discussions`)
- **Cmd+4**: Directory (route key: `directory`)
- **Cmd+5**: Collaborators (route key: `collaborators`)

This is desktop-only because `useListenAppEvent` is only available in the desktop app.

---

## Success Criteria

Phase 3 is complete when:
1. `useNavigate()` works on both platforms (URL sync on web, nav state on desktop)
2. `useOpenRoute()` is deleted - all code uses `useNavigate()`
3. Single `usePanelState()` hook works on both platforms
4. Panels open/close correctly on both platforms
5. URL stays in sync with panel state on web
6. `toggle_tool` keyboard shortcuts work on desktop (navigates primary views)
7. Panel width persists on both platforms
8. No new type files created (uses existing `@shm/shared/routes.ts`)
