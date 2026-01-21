# Web-Desktop Code Sharing & Navigation Refactor Plan

## Goal
Refactor the web app so it:
1. Shares maximum code with desktop
2. Uses the same UI components and layout patterns
3. Doesn't flash/re-render when switching between document views (Content, Activity, Discussions, Directory, Collaborators)
4. Maintains URL-based routing for SEO and shareability

## Current State Analysis

### Desktop Architecture (Target Pattern)
- **Navigation**: Custom state machine with `NavRoute` discriminated union types
- **Route types**: `document`, `activity`, `discussions`, `directory`, `collaborators`, `draft`, etc.
- **Page mounting**: Single `DocumentPage` component handles all document-related routes
- **Content switching**: `renderMainContent()` switches content based on `route.key` WITHOUT unmounting
- **Panel system**: `AccessoryLayout` with resizable right panel
- **Focus tracking**: URL-driven via `route.focus` property

Key insight: Desktop uses `getRouteKey()` to generate stable keys so the ErrorBoundary doesn't remount when switching between `document`/`activity`/`discussions`/etc.

### Web Architecture (Current)
- **Navigation**: Remix URL-based with view terms (`:activity`, `:discussions`, etc.)
- **Route detection**: Extracts `viewTerm` from URL path in loader
- **Page mounting**: Same `DocumentPage` but panel state is LOCAL React state, not URL-driven
- **Content switching**: Panel opens/closes but main content doesn't switch views
- **Focus tracking**: Local React context (`FocusProvider`)

Key problem: Web doesn't have the concept of "main content switching" - it only has panels.

## Architecture Decision

### Option A: Full NavContext Adapter for Web
Create a web adapter that maps Remix location → NavRoute and provides the same hooks (`useNavRoute`, `useFocus`, etc.)

**Pros**: Maximum code sharing, identical navigation patterns
**Cons**: Complex URL ↔ state sync, potential hydration issues

### Option B: Shared Page Component with Platform Adapters
Create platform-agnostic page components that accept route info as props, with thin platform-specific wrappers.

**Pros**: Simpler, less coupling, clearer separation
**Cons**: Some duplication in wrapper components

### Recommended: Option B with Progressive Enhancement

## Detailed Refactor Plan

### Phase 0: Panel Query Parameter for URL State

Before the main refactor, introduce `?panel=...` query param to encode panel state in URLs. This allows:
- Desktop app "Copy Link" to include panel state
- Web URLs to auto-open the correct panel when loaded
- Seamless link sharing between platforms

#### 0.1 Define Panel Query Param Format
```typescript
// Panel types that can be encoded in URL
type PanelQueryValue =
  | 'activity'
  | 'discussions'
  | 'directory'
  | 'collaborators'
  | 'options'
  | null

// Full URL examples:
// /docs/:activity                     -> main=activity, no panel
// /docs/:activity?panel=discussions   -> main=activity, panel=discussions
// /docs?panel=options                 -> main=content, panel=options
// /docs?panel=directory               -> main=content, panel=directory
```

#### 0.2 Update `entity-id-url.ts`
Add panel query param support to URL generation:

```typescript
// In getHMQueryString(), add panel support
function getHMQueryString({
  feed,
  version,
  latest,
  panel, // NEW
}: {
  feed?: boolean
  version?: string | null
  latest?: boolean | null
  panel?: string | null // NEW
}) {
  const query: Record<string, string | null> = {}
  if (version) query.v = version
  if (latest) query.l = null
  if (feed) query.feed = 'true'
  if (panel) query.panel = panel // NEW
  return serializeQueryString(query)
}

// Update routeToUrl() to extract panel from route
function getRoutePanelParam(route: NavRoute): string | null {
  if (route.key === 'document' && route.panel) {
    return route.panel.key // 'activity' | 'discussions' | 'options' etc
  }
  return null
}
```

#### 0.3 Update `copy-reference-button.tsx`
Modify to include panel in copied URLs (remove the focus-based stripping):

```typescript
// OLD: Strip panel when main is focused
if (focus === 'main' && 'panel' in route && route.panel) {
  routeForCopy = {...route, panel: null} as typeof route
}

// NEW: Always include panel in URL (via query param)
// The routeToUrl function will add ?panel= when panel exists
```

#### 0.4 Update Web Loader
Parse `panel` query param in `routes/$.tsx`:

```typescript
// In loader
const panelParam = url.searchParams.get('panel') as PanelQueryValue | null

// Pass to result
return wrapJSON({
  ...result,
  viewTerm,
  panelParam, // NEW
})
```

#### 0.5 Update Web DocumentPage
Use panelParam to initialize panel state:

```typescript
function DocumentPage({viewTerm, panelParam, ...props}) {
  // Initialize panel from URL on mount
  const [activePanel, setActivePanel] = useState<PanelType | null>(() => {
    if (panelParam) return panelParam
    return null
  })

  // Update URL when panel changes (optional, for shareability)
  useEffect(() => {
    // Update query param without full navigation
  }, [activePanel])
}
```

### Phase 1: Share Page Content Components (DONE)

Instead of a full shell (which would require significant platform abstraction), focus on sharing the page content components and ensuring consistent behavior.

#### 1.1 Shared Page Content Components
- `DirectoryPageContent` ✓ (@shm/ui/directory-page.tsx)
- `DiscussionsPageContent` ✓ (@shm/ui/discussions-page.tsx)
- `ActivityPageContent` ✓ (@shm/ui/activity-page.tsx) - NEW
- `CollaboratorsPageContent` ✓ (@shm/ui/collaborators-page.tsx) - NEW

#### 1.2 Shared Components Used by Both Platforms
- `DocumentTools` ✓ (handles tab navigation)
- `DocumentHeader` ✓
- `DocumentCover` ✓
- `PageLayout` ✓ (consistent layout for page content)
- `Feed` ✓ (activity feed)

#### 1.3 Platform-Specific Wrappers
Each platform maintains its own document page component:
- **Desktop**: Uses `AccessoryLayout` for panels, custom nav state, IPC
- **Web**: Uses `PanelGroup` for panels, Remix routing with query params

### Phase 2: Improve Web View Switching

The goal is to reduce/eliminate flash when switching between views on web.

#### 2.1 Client-Side View Switching
Web should handle view tab clicks as client-side state changes with URL updates, not full navigations:

```typescript
// In DocumentTools onClick for web
const handleViewClick = (view: ViewType) => {
  // Update local state immediately (no flash)
  setActiveView(view)

  // Update URL for shareability (using replace to avoid history spam)
  const newUrl = buildViewUrl(docId, view)
  window.history.replaceState({}, '', newUrl)
}
```

#### 2.2 Use Remix's `useNavigate` with `preventScrollReset`
When URL navigation is needed, use options to minimize disruption:

```typescript
navigate(newUrl, {
  replace: true,
  preventScrollReset: true,
  unstable_viewTransition: true, // Enable view transitions if supported
})
```

#### 2.3 React Query Cache
Both platforms use React Query. Ensure document data is cached so view switches don't trigger refetches.

### Phase 3: Future - Shared Shell (Optional)

If further code sharing is desired, a DocumentPageShell could be created that:
- Accepts `activeView` as a prop
- Renders the title, DocumentTools, and content area
- Uses render props for platform-specific parts (comment editor, etc.)

This is deferred as the current approach (shared content components + platform wrappers) achieves most of the code sharing goals.

### Phase 4: Final Cleanup

#### 6.1 Remove Duplicate Code
- Delete old platform-specific page implementations
- Consolidate imports

#### 6.2 Verify Feature Parity
- [ ] Content view works
- [ ] Activity view works
- [ ] Discussions view works
- [ ] Directory view works
- [ ] Collaborators view works
- [ ] Panel overlay works
- [ ] Focus indicators work
- [ ] URL updates correctly
- [ ] Back/forward navigation works
- [ ] No flash on view switching

## File Changes Summary

### Phase 0 Files (Panel Query Param) - DONE
- `frontend/packages/shared/src/utils/entity-id-url.ts` ✓ - Added panel query param support
- `frontend/apps/desktop/src/components/copy-reference-button.tsx` ✓ - Include panel in URLs
- `frontend/apps/web/app/routes/$.tsx` ✓ - Parse panel query param
- `frontend/apps/web/app/document.tsx` ✓ - Initialize panel from URL

### Phase 1 Files (Shared Components) - DONE
- `frontend/packages/ui/src/activity-page.tsx` ✓ - NEW shared activity page content
- `frontend/packages/ui/src/collaborators-page.tsx` ✓ - NEW shared collaborators page layout

### Existing Shared Components
- `frontend/packages/ui/src/directory-page.tsx` ✓ - Already shared
- `frontend/packages/ui/src/discussions-page.tsx` ✓ - Already shared
- `frontend/packages/ui/src/document-tools.tsx` ✓ - Already shared
- `frontend/packages/ui/src/page-layout.tsx` ✓ - Already shared

### Desktop Pages (Already Merged)
- `frontend/apps/desktop/src/pages/activity.tsx` - Already merged into document.tsx
- `frontend/apps/desktop/src/pages/directory.tsx` - Already merged into document.tsx
- `frontend/apps/desktop/src/pages/collaborators.tsx` - Already merged into document.tsx
- `frontend/apps/desktop/src/pages/discussions.tsx` - Already merged into document.tsx

## Migration Strategy

0. **Panel query param first** - Add `?panel=...` support (non-breaking, additive)
1. **Start with shell creation** - Non-breaking, additive
2. **Desktop first** - Refactor desktop to use shell, verify no regressions
3. **Web second** - Refactor web to use same shell
4. **Iterate** - Fix any platform-specific issues
5. **Cleanup** - Remove deprecated code

## Key Technical Considerations

### Panel Query Param Behavior
- `?panel=X` opens panel X regardless of main view
- Main view (`:activity`, `:discussions`, etc.) and panel are independent
- When navigating between views, panel persists unless explicitly closed
- Desktop "Copy Link" always includes panel state if panel is open
- Opening a shared link with `?panel=X` shows that panel immediately

### Hydration (Web)
- Server renders with initial `activeView` from URL
- Client must match initial state exactly
- Use `useMemo(() => initialView, [])` for stable initial state

### Scroll Restoration
- Each view may need its own scroll position
- Consider keying scroll areas by view type

### Data Loading
- Desktop: Uses React Query with persistent cache
- Web: Uses Remix loaders with hydration
- Shell should be agnostic - receive data as props

### Comments Provider
- Both platforms wrap with `CommentsProvider`
- Move wrapping into shell or keep in platform wrapper

## Success Criteria

1. **No visual flash** when switching between Content/Activity/Discussions/Directory/Collaborators
2. **URL reflects current view** on web (for shareability)
3. **90%+ code sharing** in document page UI
4. **Same visual appearance** on both platforms
5. **No performance regression**
