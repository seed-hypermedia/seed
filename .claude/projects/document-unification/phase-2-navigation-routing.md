# Phase 2: Navigation/Routing Unification

## Objective
Enable `useNavRoute()` to work on web so shared code can use the same route definitions as desktop. This allows `DocumentTools` and view switching to work identically on both platforms.

## Pre-Conditions
- Phase 1 complete: Basic document rendering works on both platforms
- `DocumentTools` already exists and uses `useRouteLink` for navigation

## Key Insight: Make `useNavRoute()` Work on Web

Currently, `WebSiteProvider` initializes the navigation context with `defaultRoute` instead of the actual route from the URL. The fix is simple:

1. Add `initialRoute` prop to `WebSiteProvider`
2. Create a utility to convert `docId + viewTerm → NavRoute`
3. Initialize nav context with the correct route
4. Shared code can now use `useNavRoute()` directly!

---

## Implementation Plan

### Step 2.1: Create Route Conversion Utility

**File**: `frontend/packages/shared/src/routes.ts` (add to existing file)

```typescript
import {UnpackedHypermediaId} from './hm-types'
import {ViewRouteKey} from './utils/entity-id-url'

/**
 * Convert docId + viewTerm into a NavRoute
 * Used by web to initialize navigation context from URL
 */
export function createDocumentNavRoute(
  docId: UnpackedHypermediaId,
  viewTerm?: ViewRouteKey | null,
): NavRoute {
  switch (viewTerm) {
    case 'activity':
      return {key: 'activity', id: docId}
    case 'discussions':
      return {key: 'discussions', id: docId}
    case 'directory':
      return {key: 'directory', id: docId}
    case 'collaborators':
      return {key: 'collaborators', id: docId}
    default:
      return {key: 'document', id: docId}
  }
}
```

### Step 2.2: Add `initialRoute` to `WebSiteProvider`

**File**: [providers.tsx](frontend/apps/web/app/providers.tsx)

```typescript
export function WebSiteProvider(props: {
  originHomeId: UnpackedHypermediaId
  children: React.ReactNode
  siteHost?: string
  origin?: string
  prefersLanguages?: (keyof typeof languagePacks)[]
  dehydratedState?: DehydratedState
  initialRoute?: NavRoute  // NEW
}) {
  // ...

  // Create navigation context with initial route
  const navigation = useMemo(() => {
    const initialNav: NavState = {
      sidebarLocked: false,
      routes: [props.initialRoute ?? defaultRoute],  // USE initialRoute
      routeIndex: 0,
      lastAction: 'replace',
    }
    const [updateNavState, navState] = writeableStateStream(initialNav)

    return {
      dispatch(action: NavAction) {
        const prevState = navState.get()
        const newState = navStateReducer(prevState, action)
        if (prevState !== newState) {
          updateNavState(newState)
        }
      },
      state: navState,
    }
  }, [])  // Note: intentionally not depending on initialRoute to avoid recreating on nav

  // ...
}
```

### Step 2.3: Update Route Entry Points to Pass `initialRoute`

**File**: [routes/$.tsx](frontend/apps/web/app/routes/$.tsx)

```typescript
import {createDocumentNavRoute} from '@shm/shared'

// In UnifiedDocumentPage:
return (
  <WebSiteProvider
    origin={data.origin}
    originHomeId={data.originHomeId}
    siteHost={data.siteHost}
    dehydratedState={data.dehydratedState}
    initialRoute={createDocumentNavRoute(data.id, data.viewTerm)}  // NEW
  >
    <WebResourcePage docId={data.id} />
  </WebSiteProvider>
)
```

**File**: [routes/_index.tsx](frontend/apps/web/app/routes/_index.tsx)

```typescript
import {createDocumentNavRoute} from '@shm/shared'

// In HomePage:
return (
  <WebSiteProvider
    origin={data.origin}
    originHomeId={data.originHomeId}
    siteHost={data.siteHost}
    dehydratedState={data.dehydratedState}
    initialRoute={createDocumentNavRoute(data.id)}  // NEW (no viewTerm for home)
  >
    <WebResourcePage docId={data.id} />
  </WebSiteProvider>
)
```

### Step 2.4: Update `ResourcePage` to Use `useNavRoute()`

**File**: [resource-page-common.tsx](frontend/packages/ui/src/resource-page-common.tsx)

Now we can use `useNavRoute()` directly in shared code!

```typescript
import {useNavRoute} from '@shm/shared/utils/navigation'
import {DocumentTools} from './document-tools'
import {DirectoryPageContent} from './directory-page'
import {DiscussionsPageContent} from './discussions-page'
import {ReadOnlyCollaboratorsContent} from './collaborators-page'
import {Feed} from './feed'

export type ActiveView = 'content' | 'activity' | 'discussions' | 'directory' | 'collaborators'

// Helper to get activeView from route
function getActiveView(routeKey: string): ActiveView {
  switch (routeKey) {
    case 'activity': return 'activity'
    case 'discussions': return 'discussions'
    case 'directory': return 'directory'
    case 'collaborators': return 'collaborators'
    default: return 'content'
  }
}

export function ResourcePage({docId}: ResourcePageProps) {
  const route = useNavRoute()  // Works on both platforms now!
  const activeView = getActiveView(route.key)

  // ... rest of implementation
}
```

### Step 2.5: Add `DocumentTools` and View Switching

**File**: [resource-page-common.tsx](frontend/packages/ui/src/resource-page-common.tsx)

Update `DocumentBody` to include `DocumentTools` and switch content:

```typescript
function DocumentBody({
  docId,
  document,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
}) {
  const route = useNavRoute()
  const activeView = getActiveView(route.key)

  const isHomeDoc = !docId.path?.length
  const directory = useDirectory(docId)
  const interactionSummary = useInteractionSummary(docId)

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    wrapperProps,
    contentMaxWidth,
  } = useDocumentLayout({
    contentWidth: document.metadata?.contentWidth,
    showSidebars: !isHomeDoc && document.metadata?.showOutline !== false,
  })

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" ref={elementRef}>
      <ScrollArea className="flex-1">
        <DocumentCover cover={document.metadata?.cover} />

        <div
          className={cn('mx-auto flex w-full flex-col px-4', isHomeDoc && 'mt-6')}
          style={{maxWidth: contentMaxWidth}}
        >
          {!isHomeDoc && (
            <DocumentHeader
              docId={docId}
              docMetadata={document.metadata}
              authors={[]}
              updateTime={document.updateTime}
            />
          )}
        </div>

        {/* DocumentTools tab bar */}
        <DocumentTools
          id={docId}
          activeTab={activeView}
          commentsCount={interactionSummary.data?.comments || 0}
          directoryCount={directory.data?.length}
        />

        {/* Main content based on activeView */}
        <MainContent
          docId={docId}
          document={document}
          activeView={activeView}
          contentMaxWidth={contentMaxWidth}
          wrapperProps={wrapperProps}
          sidebarProps={sidebarProps}
          mainContentProps={mainContentProps}
          showSidebars={showSidebars}
        />
      </ScrollArea>
    </div>
  )
}

function MainContent({
  docId,
  document,
  activeView,
  contentMaxWidth,
  wrapperProps,
  sidebarProps,
  mainContentProps,
  showSidebars,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  activeView: ActiveView
  contentMaxWidth: number
  wrapperProps: React.HTMLAttributes<HTMLDivElement>
  sidebarProps: React.HTMLAttributes<HTMLDivElement>
  mainContentProps: React.HTMLAttributes<HTMLDivElement>
  showSidebars: boolean
}) {
  switch (activeView) {
    case 'directory':
      return (
        <DirectoryPageContent
          docId={docId}
          showTitle={false}
          contentMaxWidth={contentMaxWidth}
        />
      )

    case 'collaborators':
      return (
        <div className="mx-auto w-full px-4" style={{maxWidth: contentMaxWidth}}>
          <ReadOnlyCollaboratorsContent docId={docId} />
        </div>
      )

    case 'activity':
      return (
        <div className="mx-auto w-full px-4" style={{maxWidth: contentMaxWidth}}>
          <Feed size="md" centered filterResource={docId.id} />
        </div>
      )

    case 'discussions':
      return (
        <DiscussionsPageContent
          docId={docId}
          showTitle={false}
          contentMaxWidth={contentMaxWidth}
        />
      )

    case 'content':
    default:
      return (
        <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
          {showSidebars && <div {...sidebarProps} />}
          <div {...mainContentProps}>
            <BlocksContentProvider resourceId={docId}>
              <BlocksContent blocks={document.content} />
            </BlocksContentProvider>
          </div>
          {showSidebars && <div {...sidebarProps} />}
        </div>
      )
  }
}
```

### Step 2.6: Simplify Desktop Wrapper

**File**: [desktop-resource.tsx](frontend/apps/desktop/src/pages/desktop-resource.tsx)

Desktop no longer needs to pass `activeView` - it just works via `useNavRoute()`:

```typescript
import {useNavRoute} from '@shm/shared/utils/navigation'
import {ResourcePage} from '@shm/ui/resource-page-common'

export default function DesktopResourcePage() {
  const route = useNavRoute()

  const supportedKeys = [
    'document', 'feed', 'directory', 'collaborators', 'activity', 'discussions',
  ]
  if (!supportedKeys.includes(route.key)) {
    throw new Error(`DesktopResourcePage: unsupported route ${route.key}`)
  }

  // @ts-expect-error - route.id exists on all supported route types
  const docId = route.id
  if (!docId) throw new Error('No document ID in route')

  return <ResourcePage docId={docId} />  // No activeView prop needed!
}
```

---

## Files Modified Summary

| File | Change |
|------|--------|
| `shared/src/routes.ts` | Add `createDocumentNavRoute()` utility |
| `web/app/providers.tsx` | Add `initialRoute` prop to `WebSiteProvider` |
| `web/app/routes/$.tsx` | Pass `initialRoute` to `WebSiteProvider` |
| `web/app/routes/_index.tsx` | Pass `initialRoute` to `WebSiteProvider` |
| `ui/src/resource-page-common.tsx` | Use `useNavRoute()`, add `DocumentTools`, add `MainContent` |
| `desktop/src/pages/desktop-resource.tsx` | Remove any activeView prop (stays simple) |

---

## Why This Approach Is Better

1. **Shared Route Definitions**: Both platforms use the same `NavRoute` types from `@shm/shared/routes`
2. **Single Source of Truth**: `useNavRoute()` works everywhere - no platform-specific props
3. **Reusable Infrastructure**: `createDocumentNavRoute()` can be used anywhere URL → route conversion is needed
4. **Minimal Changes**: Just add `initialRoute` prop, no major refactoring
5. **Type Safety**: Full TypeScript support for route types

---

## Testing Checklist

### Desktop Testing

1. **View Term Navigation**
   - [ ] Click "Activity" in DocumentTools → shows activity feed
   - [ ] Click "Comments" → shows discussions view
   - [ ] Click "Directory" → shows directory view
   - [ ] Click "Collaborators" → shows collaborators view
   - [ ] Click "Content" → shows document body

2. **Route Persistence**
   - [ ] Navigate to activity view, navigate to another doc, go back → returns to activity
   - [ ] Back/forward buttons work correctly

### Web Testing

1. **URL-Based Navigation**
   - [ ] `/doc/:activity` shows activity view
   - [ ] `/doc/:discussions` shows discussions view
   - [ ] `/doc/:directory` shows directory view
   - [ ] `/doc/:collaborators` shows collaborators view
   - [ ] `/doc` shows document content

2. **Tab Navigation**
   - [ ] Clicking tabs updates URL correctly
   - [ ] Browser back/forward works
   - [ ] Refresh preserves view
   - [ ] `useNavRoute()` returns correct route on initial render

3. **SSR Correctness**
   - [ ] No hydration mismatches
   - [ ] View source shows correct initial content

### Cross-Platform Consistency
- [ ] Same content appears on both platforms for same route
- [ ] `useNavRoute()` returns equivalent routes on both platforms
- [ ] Layout is consistent

---

## Success Criteria

Phase 2 is complete when:
1. `useNavRoute()` works correctly on web (returns correct route from URL)
2. All view term routes work on desktop (activity, discussions, directory, collaborators)
3. All view term URLs work on web (`:activity`, `:discussions`, etc.)
4. `DocumentTools` tabs switch views correctly on both platforms
5. Shared code uses `useNavRoute()` without platform-specific props
6. No console errors or hydration mismatches
