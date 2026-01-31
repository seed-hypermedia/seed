# Phase 1: Basic ResourcePage Scaffold

## Objective
Get a minimal working document page that renders document content on both platforms using the new shared `ResourcePage` component. The component should use React Query's `useResource` hook internally and render the unified `SiteHeader`.

## Pre-Conditions
- Legacy implementations backed up as `desktop-legacy-document.tsx` and `web-legacy-document.tsx`
- Entry points modified to use `ResourcePage` (already done in working copy)
- `resource-page-common.tsx` exists as placeholder
- React Query is pre-hydrated from SSR on web (via `WebSiteProvider`)

## Scope

### In Scope
- Basic document content rendering (`BlocksContent`)
- Unified `SiteHeader` component (merge SiteHeader/WebSiteHeader distinction)
- Document header/metadata display
- Document cover image
- Loading and error states
- Not-found/discovery states

### Out of Scope (Later Phases)
- Panels/accessories
- View term routing (activity, discussions, etc.)
- Mobile-specific layouts (bottom bar, panel sheet)
- Editing capabilities
- Comments
- Keyboard shortcuts

---

## Key Insight: React Query Hydration

The web app pre-hydrates React Query on the server:

1. **Server**: `loadSiteResource()` in `loaders.ts` prefetches data into a query context
2. **Server**: Returns `dehydratedState` in the response
3. **Client**: `WebSiteProvider` calls `hydrate(client, dehydratedState)` synchronously
4. **Client**: Any `useResource()` calls immediately find data in cache

This means **ResourcePage can call `useResource()` directly** - no need to pass loader data as props!

---

## Implementation Steps

### Step 1.1: Create Unified ResourcePage Component

**File**: `frontend/packages/ui/src/resource-page-common.tsx`

The ResourcePage component should:
1. Accept a `docId: UnpackedHypermediaId` prop
2. Call `useResource(docId)` to get document data
3. Handle all states (loading, error, not-found, redirect, tombstone)
4. Render `SiteHeader` with proper data
5. Render document content via `BlocksContent`

```typescript
// frontend/packages/ui/src/resource-page-common.tsx
import { useResource, useDirectory } from '@shm/shared/models/entity'
import { SiteHeader } from './site-header'
import { BlocksContent, BlocksContentProvider } from './blocks-content'
import { DocumentCover } from './document-cover'
import { DocumentHeader } from './document-header'
import { PageDeleted, PageDiscovery, PageNotFound, PageRedirected } from './page-message-states'
import { useDocumentLayout } from './layout'
import { ScrollArea } from './components/scroll-area'
import { Spinner } from './spinner'
import { cn } from './utils'

export interface ResourcePageProps {
  docId: UnpackedHypermediaId

  // Platform-specific props
  wrapperClassName?: string           // e.g., "fixed sm:static" for web
  notifyServiceHost?: string          // For subscription prompts
  onBlockFocus?: (blockId: string) => void
  onShowMobileMenu?: (open: boolean) => void
}

export function ResourcePage({
  docId,
  wrapperClassName,
  notifyServiceHost,
  onBlockFocus,
  onShowMobileMenu,
}: ResourcePageProps) {
  // Load document data via React Query (pre-hydrated on web)
  const resource = useResource(docId, {
    subscribed: true,
    recursive: true,
  })

  // Load home site entity for header
  const siteHomeId = hmId(docId.uid)
  const siteHomeResource = useResource(siteHomeId, { subscribed: true })
  const homeDirectory = useDirectory(siteHomeId)

  // Handle loading state
  if (resource.isInitialLoading) {
    return <PageContainer><Spinner /></PageContainer>
  }

  // Handle discovery state
  if (resource.isDiscovering) {
    return <PageContainer><PageDiscovery /></PageContainer>
  }

  // Handle not-found
  if (!resource.data || resource.data.type === 'not-found') {
    return <PageContainer><PageNotFound /></PageContainer>
  }

  // Handle redirect
  if (resource.data.type === 'redirect') {
    return (
      <PageRedirected
        docId={docId}
        redirectTarget={resource.data.redirectTarget}
        onNavigate={(target) => {/* navigation will be handled */}}
      />
    )
  }

  // Handle tombstone (deleted)
  if (resource.isTombstone || resource.data.type === 'tombstone') {
    return <PageContainer><PageDeleted /></PageContainer>
  }

  // Handle error
  if (resource.data.type === 'error') {
    return <PageContainer><DocErrorMessage message={resource.data.message} /></PageContainer>
  }

  // Success: render document
  const document = resource.data.document
  const siteHomeDocument = siteHomeResource.data?.type === 'document'
    ? siteHomeResource.data.document
    : null

  return (
    <ResourcePageContent
      docId={docId}
      document={document}
      siteHomeId={siteHomeId}
      siteHomeDocument={siteHomeDocument}
      homeDirectory={homeDirectory.data}
      wrapperClassName={wrapperClassName}
      notifyServiceHost={notifyServiceHost}
      onBlockFocus={onBlockFocus}
      onShowMobileMenu={onShowMobileMenu}
    />
  )
}
```

### Step 1.2: Create Unified Site Header Logic

Instead of having `WebSiteHeader` and `_AppDocSiteHeader` separately, the ResourcePage should handle the header setup:

```typescript
// Inside ResourcePageContent
function ResourcePageContent({
  docId,
  document,
  siteHomeId,
  siteHomeDocument,
  homeDirectory,
  wrapperClassName,
  notifyServiceHost,
  onBlockFocus,
  onShowMobileMenu,
}: ResourcePageContentProps) {
  const isHomeDoc = !docId.path?.length

  // Compute navigation items (same logic as WebSiteHeader)
  const navigationBlockNode = siteHomeDocument?.detachedBlocks?.navigation
  const homeNavigationItems = navigationBlockNode
    ? navigationBlockNode.children
        ?.map((child) => {
          const linkBlock = child.block.type === 'Link' ? child.block : null
          if (!linkBlock) return null
          const id = unpackHmId(linkBlock.link)
          return {
            isPublished: true,
            isDraft: false,
            key: linkBlock.id,
            metadata: { name: linkBlock.text || '' },
            id: id || undefined,
            webUrl: id ? undefined : linkBlock.link,
          }
        })
        .filter((item) => !!item) || []
    : []

  const directoryItems = getSiteNavDirectory({
    id: siteHomeId,
    directory: homeDirectory ?? undefined,
  })

  const items = homeNavigationItems.length > 0 ? homeNavigationItems : directoryItems

  const isCenterLayout =
    siteHomeDocument?.metadata?.theme?.headerLayout === 'Center' ||
    siteHomeDocument?.metadata?.layout === 'Seed/Experimental/Newspaper'

  return (
    <div className={cn('flex h-full flex-col')}>
      <SiteHeader
        siteHomeId={siteHomeId}
        docId={docId}
        items={items}
        homeNavigationItems={homeNavigationItems}
        directoryItems={directoryItems}
        isCenterLayout={isCenterLayout}
        document={document}
        siteHomeDocument={siteHomeDocument}
        onBlockFocus={onBlockFocus || defaultBlockFocus}
        onShowMobileMenu={onShowMobileMenu || defaultMobileMenu}
        isMainFeedVisible={false} // Will be based on route later
        wrapperClassName={wrapperClassName}
        notifyServiceHost={notifyServiceHost}
      />

      <DocumentBody docId={docId} document={document} />
    </div>
  )
}

function defaultBlockFocus(blockId: string) {
  const element = document.getElementById(blockId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function defaultMobileMenu(open: boolean) {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = open ? 'hidden' : 'auto'
  }
}
```

### Step 1.3: Create Document Body Component

```typescript
function DocumentBody({ docId, document }: { docId: UnpackedHypermediaId; document: HMDocument }) {
  const isHomeDoc = !docId.path?.length

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
    <div className="relative flex h-full flex-col" ref={elementRef}>
      <ScrollArea>
        <DocumentCover cover={document.metadata?.cover} />

        <div
          className={cn('mx-auto flex w-full flex-col px-4', isHomeDoc && 'mt-6')}
          style={{ maxWidth: contentMaxWidth }}
        >
          {!isHomeDoc && (
            <DocumentHeader
              docId={docId}
              docMetadata={document.metadata}
              updateTime={document.updateTime}
            />
          )}
        </div>

        <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
          {showSidebars && (
            <div {...sidebarProps}>
              {/* Document outline - placeholder for now */}
            </div>
          )}

          <div {...mainContentProps}>
            <BlocksContentProvider resourceId={docId}>
              <BlocksContent blocks={document.content} />
            </BlocksContentProvider>
          </div>

          {showSidebars && <div {...sidebarProps} />}
        </div>
      </ScrollArea>
    </div>
  )
}
```

### Step 1.4: Update Web Route Wrapper

**File**: `frontend/apps/web/app/routes/$.tsx` (update)

The route already loads data and hydrates React Query. We just need to pass the docId:

```typescript
export default function UnifiedDocumentPage() {
  const unwrappedData = useLoaderData()
  const data = unwrap<DocumentPayload>(unwrappedData)

  if (data === 'unregistered') return <NotRegisteredPage />
  if (data === 'no-site') return <NoSitePage />

  if (data.daemonError && data.daemonError.code !== Code.NotFound) {
    return <DaemonErrorPage {...data.daemonError} />
  }

  if (data.feed) {
    return <FeedPage {...data} />
  }

  // Pass docId to ResourcePage - it will load data from hydrated React Query cache
  return (
    <WebSiteProvider
      origin={data.origin}
      originHomeId={data.originHomeId}
      siteHost={data.siteHost}
      dehydratedState={data.dehydratedState}
    >
      <ResourcePage
        docId={data.id}
        wrapperClassName="fixed sm:static"
        notifyServiceHost={NOTIFY_SERVICE_HOST}
      />
    </WebSiteProvider>
  )
}
```

### Step 1.5: Update Index Route

**File**: `frontend/apps/web/app/routes/_index.tsx` (update)

Same pattern:

```typescript
export default function IndexPage() {
  const unwrappedData = useLoaderData()
  const data = unwrap<DocumentPayload>(unwrappedData)

  if (data === 'unregistered') return <NotRegisteredPage />
  if (data === 'no-site') return <NoSitePage />

  if (data.daemonError && data.daemonError.code !== Code.NotFound) {
    return <DaemonErrorPage {...data.daemonError} />
  }

  return (
    <WebSiteProvider
      origin={data.origin}
      originHomeId={data.originHomeId}
      siteHost={data.siteHost}
      dehydratedState={data.dehydratedState}
    >
      <ResourcePage
        docId={data.id}
        wrapperClassName="fixed sm:static"
        notifyServiceHost={NOTIFY_SERVICE_HOST}
      />
    </WebSiteProvider>
  )
}
```

### Step 1.6: Verify Desktop Still Works

The desktop already uses `useResource` and `useNavRoute`. The `desktop-resource.tsx` wrapper should:

1. Get `docId` from `useNavRoute()`
2. Pass to `ResourcePage`

```typescript
// frontend/apps/desktop/src/pages/desktop-resource.tsx
import { useNavRoute } from '@shm/shared/utils/navigation'
import { ResourcePage } from '@shm/ui/resource-page-common'

export default function DesktopResourcePage() {
  const route = useNavRoute()

  // Only handle document-related routes
  const supportedKeys = ['document', 'feed', 'directory', 'collaborators', 'activity', 'discussions']
  if (!supportedKeys.includes(route.key)) {
    throw new Error(`DesktopResourcePage: unsupported route ${route.key}`)
  }

  const docId = route.id
  if (!docId) throw new Error('No document ID in route')

  return (
    <ResourcePage
      docId={docId}
      // Desktop doesn't need wrapperClassName
      // Desktop handles notifyServiceHost differently (via useNotifyServiceHost)
    />
  )
}
```

---

## Testing Checklist

### Desktop Testing

1. **App Launch**
   - [ ] `./dev run-desktop` starts without errors
   - [ ] No console errors on launch

2. **Document Loading**
   - [ ] Navigate to a document from library
   - [ ] Document content renders correctly
   - [ ] Document header shows title and metadata
   - [ ] Cover image displays if present
   - [ ] SiteHeader displays correctly

3. **States**
   - [ ] Loading spinner shows while fetching
   - [ ] Not-found page shows for invalid documents
   - [ ] Error page shows for errors

4. **Basic Navigation**
   - [ ] Can navigate between documents
   - [ ] Back/forward works

### Web Testing

1. **Page Load**
   - [ ] `yarn web` starts without errors
   - [ ] No hydration mismatch errors in console
   - [ ] Page renders on server (view source shows content)

2. **Document Display**
   - [ ] Document content renders correctly
   - [ ] Document header shows title and metadata
   - [ ] Cover image displays if present
   - [ ] SiteHeader displays correctly

3. **States**
   - [ ] Not-found page shows for invalid URLs
   - [ ] Discovery page shows when finding document

4. **Navigation**
   - [ ] Links to other documents work
   - [ ] Browser back/forward works

### Known Limitations (Expected)
- No panel/accessory support yet
- No view term routes (activity, discussions)
- No mobile layout optimization (bottom bar, panel sheet)
- No editing capabilities
- No comments
- No document outline in sidebar yet

---

## Rollback Plan

If this phase causes issues:
1. In route files, import `DocumentPage` from `web-legacy-document.tsx` instead
2. Desktop: Update `main.tsx` to import from `desktop-legacy-document.tsx`

The legacy files are preserved for easy rollback.

---

## Success Criteria

Phase 1 is complete when:
1. Documents render on both desktop and web
2. SiteHeader displays correctly on both platforms
3. All document states handled (loading, error, not-found, etc.)
4. BlocksContent renders document body
5. No regressions from legacy implementation for basic document viewing
6. No console errors during normal usage
