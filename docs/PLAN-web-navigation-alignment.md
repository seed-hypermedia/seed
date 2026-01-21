# Plan: Web Navigation Alignment with Desktop

## Overview
The desktop app has a mature navigation system with route-based state, panel support, and focus management. The web app should align with this architecture to enable feature parity and code reuse.

## Current State

### Desktop Navigation (`frontend/apps/desktop`)
- **NavState** in `@shm/shared/utils/navigation.tsx` - holds routes array, index, UI state
- **StateStream** pattern for reactive updates
- **Routes** defined in `@shm/shared/routes.ts` - shared types
- **Panels** supported via `route.panel` with focus tracking
- **History** managed in-memory with back/forward support
- **Persistence** via serialization to localStorage
- **Focus system** - `useFocus()` hook, glow indicators on focused panel, URL-driven focus state

### Web Navigation (`frontend/apps/web`)
- Uses Remix's built-in routing
- URL-based state (query params, path segments)
- Panel support with activity/discussions panels
- Focus system with glow indicators (state-based)

## URL Schema

### View Term Routes
View terms (`:activity`, `:discussions`, `:directory`, `:collaborators`) work as path suffixes for any document URL:

```
# With /hm/{uid} prefix (cross-site documents)
/hm/{uid}/:activity
/hm/{uid}/:discussions
/hm/{uid}/{path}/:directory
/hm/{uid}/{path}/:collaborators

# With pretty paths (site's own documents)
/path/to/doc/:activity
/path/to/doc/:discussions
/another/doc/:directory

# Root document views
/:activity          → activity for home document
/:discussions       → discussions for home document
/:directory         → directory listing of top-level docs
/:collaborators     → collaborators of home document
```

### Route Mapping
```
DocumentRoute       → /hm/{uid}/{path} or /{path}
FeedRoute           → /hm/{uid}/:feed or /:feed
ActivityRoute       → /hm/{uid}/{path}/:activity or /{path}/:activity
DiscussionsRoute    → /hm/{uid}/{path}/:discussions or /{path}/:discussions
DirectoryRoute      → /hm/{uid}/{path}/:directory or /{path}/:directory
CollaboratorsRoute  → /hm/{uid}/{path}/:collaborators or /{path}/:collaborators
```

### Focus Behavior
Focus is managed via local state (not URL):
- Visual glow indicator shows which panel/section is focused
- Clicking within main content or accessory panel updates focus state
- Focus state persists during session but doesn't affect URL
- The URL path itself determines what content is shown (e.g., `/:directory` shows directory as main content)

## Implementation Status

### Phase 1: URL Parsing for View Terms ✅ DONE
Updated `frontend/apps/web/app/routes/$.tsx` loader to:
1. Extract view terms from URL path (`:activity`, `:discussions`, etc.)
2. Support view terms on root path (`/:directory` → directory of home doc)
3. Support view terms on pretty paths (`/path/to/doc/:activity`)
4. Pass view term to page component for rendering appropriate page

**Files modified:**
- `frontend/apps/web/app/routes/$.tsx` - added `extractViewTermFromPath()` and view term handling
- `frontend/apps/web/app/routes/_index.tsx` - added view term support

### Phase 2: View Term Page Components ✅ DONE
Created unified view term page component:

**Files created:**
- `frontend/apps/web/app/view-term-page.tsx` - handles all view terms (activity, discussions, directory, collaborators)

Features:
- `DocumentTools` component for tab navigation between views
- URL-based navigation (`:activity`, `:discussions`, `:directory`, `:collaborators`)
- Web-specific content components that don't depend on `useNavRoute()`:
  - `WebDirectoryContent` - uses `useDirectoryData` + `DirectoryListView`
  - `WebDiscussionsContent` - uses `Discussions` component
  - `WebCollaboratorsList` - placeholder (read-only for now)
- Activity view uses lazy-loaded `Feed` component

Reuses shared UI components:
- `@shm/ui/directory-page.tsx` - `DirectoryListView`, `DirectoryEmpty`, `useDirectoryData`
- `@shm/ui/comments.tsx` - `Discussions`
- `@shm/ui/collaborators-page.tsx` - `CollaboratorsPageContent`
- `@shm/ui/feed.tsx` - `Feed` for activity view
- `@shm/ui/document-tools.tsx` - `DocumentTools` for tab navigation
- `@shm/ui/page-layout.tsx` - `PageLayout` wrapper

### Phase 3: Focus System for Web ✅ DONE
Ported focus behavior from desktop's `AccessoryLayout`:

1. **State-based focus** via React context
   - `FocusProvider` wraps document content
   - `useFocusContext()` hook for focus state access
   - Default to `main` when no panel, `panel` when panel opens

2. **Visual focus indicators**
   - `ring-2 ring-blue-500/40` glow on focused section
   - Matches desktop pattern exactly

3. **Click handlers via `FocusableArea` component**
   - Wraps main content and accessory panel
   - Excludes interactive elements from focus changes
   - Pure state updates, no URL changes

**Files created:**
- `frontend/apps/web/app/focus-context.tsx` - React context for focus state

**Files modified:**
- `frontend/apps/web/app/document.tsx` - added `FocusProvider`, `FocusableArea` wrappers

### Phase 4: Web Navigation Context (Future)
Optional - create a web-compatible navigation context for code reuse:

```typescript
// frontend/apps/web/app/navigation-context.tsx
export function WebNavContextProvider({children}: {children: ReactNode}) {
  const location = useLocation()
  const navigate = useRemixNavigate()

  const route = useMemo(() => urlToNavRoute(location), [location])

  // ... provide NavContextProvider compatible interface
}
```

This would enable using `useNavRoute()` etc. from `@shm/shared` on web.

### Phase 5: Shared UI Components (Future)
Move focus-aware components to `@shm/ui`:
- `FocusablePanel` - wrapper with click-to-focus and glow
- Extract focus ring styles to shared utility

## Benefits
- **Code reuse**: Same route types, same hooks, same UI components
- **Feature parity**: Focus and panels work identically on web/desktop
- **Deep linking**: URLs capture content state via view terms
- **Familiar UX**: Users get same visual feedback on both platforms

## Open Questions
1. Mobile UX for panels (drawer? modal? separate page?)
2. How to handle web-specific routes (auth, settings) in shared type system?
