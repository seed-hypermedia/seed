# Scroll Restoration for Accessory Panels

## Overview

Implemented scroll restoration for accessory panels (Activity, Discussions, Directory, Collaborators, Contacts) to preserve scroll position when navigating between panels or routes.

## Architecture

### Unified Implementation

**Core Hook**: `frontend/packages/ui/src/use-scroll-restoration.ts`

A single, unified hook that works across both desktop and web apps. The hook is framework-agnostic and accepts a configuration object to adapt to different navigation systems.

**Key Features**:
- **Callback ref pattern** to capture scroll container when it mounts
- **State** (not ref) for viewport to trigger effect when viewport is ready
- **sessionStorage** to persist scroll positions across navigation
- **Throttled scroll saves** (16ms / ~60fps) for performance
- **Optional debug logging** for troubleshooting
- **Configurable skip logic** for hash-only changes or other scenarios
- **Native scroll support** for non-custom scroll areas

**Storage key format**: `scroll-{scrollId}-{storageKey}`

### Platform-Specific Wrapper

**Web only**: `frontend/apps/web/app/use-scroll-restoration.ts`

The web app has a wrapper hook that adds hash-only change detection - a critical feature for Remix navigation:
- Uses Remix's `location.key` for storage keys
- **Hash-only change detection**: Skips scroll restoration when only the hash changes (e.g., clicking blocks in document outline)
- Maintains state with refs to track previous pathname/search
- Supports native scroll option
- API: `useScrollRestoration(scrollId, useNativeScroll?)`

**Why no desktop wrapper?**

Desktop components use the base hook directly because:
- Simple configuration: Just `getRouteKey(route)` - no complex logic needed
- No hash-detection requirements: Desktop navigation doesn't need this feature
- Explicit is better: Config visible at call site, easier to understand
- Less abstraction: One fewer layer makes the code clearer

Example desktop usage:
```typescript
const route = useNavRoute()
const scrollRef = useScrollRestoration({
  scrollId: `discussions-${docId.id}`,
  getStorageKey: () => getRouteKey(route),
  debug: true,
})
```

**When to use a wrapper:**

Create a platform wrapper when:
- ✅ Complex configuration logic (like web's hash detection)
- ✅ Stateful logic needed across all usages
- ✅ Multiple lines of boilerplate to eliminate

Don't create a wrapper when:
- ❌ Configuration is 1-2 lines
- ❌ Logic is simple and self-documenting
- ❌ It adds abstraction without real benefit

## How It Works

**Flow**:
1. **Web**: Component calls wrapper hook with simple API → wrapper configures base hook
   **Desktop**: Component calls base hook directly with config object
2. Base hook returns callback ref (`setContainerRef`)
3. When ref is attached to DOM:
   - Finds viewport element (`[data-slot="scroll-area-viewport"]` or native)
   - Sets viewport state → triggers re-render → triggers effect
4. Effect runs with viewport ready:
   - Checks if restoration should be skipped
   - Generates storage key
   - Restores saved scroll position OR scrolls to top
   - Attaches throttled scroll listener to save position
5. On navigation:
   - Effect cleans up old listener
   - Reruns with new storage key
   - Restores position for new route

**Key Design Decisions**:
- **Preserve panel scroll**: Switching between Activity ↔ Discussions preserves each panel's scroll
- **Reset on content change**: Changing filters or opening different comments resets scroll to top
- **Route-based keys**: Storage key includes route/location to handle navigation properly
- **Hash-only skip**: Web version skips restoration on hash-only changes for smooth block scrolling

## What Changed from Previous Implementation

### Original State (Multiple Broken Implementations)

**Desktop version problems**:
1. ❌ Used `useRef` for viewport - effect ran before ref was set
2. ❌ Effect dependencies `[route, scrollId]` didn't include viewport
3. ❌ Scroll listener never attached because viewport was always null
4. ❌ No scroll positions were saved
5. ❌ No throttling on scroll saves
6. ❌ Duplicate implementation code

**Web version problems**:
1. ❌ Same `useRef` timing issue (worked by luck due to Remix's rendering)
2. ❌ Duplicate implementation code
3. ⚠️ Potential for bugs if web rendering changed

**Result**: Desktop scroll restoration didn't work, web worked inconsistently, code duplication

### Refactored Solution (Unified + Working)

**Improvements**:
1. ✅ **Single source of truth**: One implementation in `@shm/ui` package
2. ✅ **Callback ref pattern**: `setContainerRef` captures container immediately
3. ✅ **State for viewport**: `useState<HTMLElement | null>` triggers re-render when set
4. ✅ **Proper effect dependencies**: `[storageKey, scrollId, viewport, ...]`
5. ✅ **Throttled saves**: 16ms throttling (~60fps) for performance
6. ✅ **Configurable**: Adapts to different navigation systems via options
7. ✅ **Debug support**: Optional logging for troubleshooting
8. ✅ **Minimal abstraction**: Desktop uses base hook directly (no unnecessary wrapper), Web has wrapper only for complex hash-detection logic

**Timing sequence**:
```
Component renders
  ↓
Callback ref fires: setContainerRef(node)
  ↓
setViewport(vp) → state update
  ↓
Re-render with viewport set
  ↓
Effect runs with viewport ready
  ↓
Restore scroll + attach listener
```

**Architecture benefits**:
- Bug fixes in one place benefit both apps
- Easy to add new platforms (mobile, etc.)
- Clear separation: unified logic vs platform-specific config
- Better testability

## API Reference

### Base Hook (Used by Desktop)

```typescript
import {useScrollRestoration} from '@shm/ui/use-scroll-restoration'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'

const route = useNavRoute()
const scrollRef = useScrollRestoration({
  scrollId: string,             // Unique identifier for this scroll area
  getStorageKey: () => string,  // Function to get current navigation key
  useNativeScroll?: boolean,    // Use native scroll instead of custom (default: false)
  debug?: boolean,              // Enable console logging (default: false)
  shouldSkipRestoration?: () => boolean,  // Optional skip logic (default: undefined)
})

// Desktop example
const scrollRef = useScrollRestoration({
  scrollId: `discussions-${docId.id}`,
  getStorageKey: () => getRouteKey(route),
  debug: true,
})
```

### Web Wrapper

```typescript
import {useScrollRestoration} from './use-scroll-restoration'

// Simple API with hash-only change detection built in
const scrollRef = useScrollRestoration('panel-name-{docId}')
const scrollRefNative = useScrollRestoration('panel-name-{docId}', true)
```

## Component Changes

### UI Package Components

Added `scrollRef` prop to:
- `Feed` component ([frontend/packages/ui/src/feed.tsx](frontend/packages/ui/src/feed.tsx))
- `Discussions` component ([frontend/packages/ui/src/comments.tsx](frontend/packages/ui/src/comments.tsx))
- `BlockDiscussions` component
- `CommentDiscussions` component

All pass `scrollRef` to `AccessoryContent` wrapper.

### Desktop App Panels

Added scroll restoration to:
- `DiscussionsPanel` ([frontend/apps/desktop/src/components/discussions-panel.tsx](frontend/apps/desktop/src/components/discussions-panel.tsx))
- `DirectoryPanel` ([frontend/apps/desktop/src/components/directory-panel.tsx](frontend/apps/desktop/src/components/directory-panel.tsx))
- `CollaboratorsPanel` ([frontend/apps/desktop/src/components/collaborators-panel.tsx](frontend/apps/desktop/src/components/collaborators-panel.tsx))
- Activity panel in `document-accessory.tsx`
- Contacts panel in `document-accessory.tsx`
- Feed page ([frontend/apps/desktop/src/pages/feed.tsx](frontend/apps/desktop/src/pages/feed.tsx))

**Pattern** (uses base hook directly):
```typescript
const route = useNavRoute()
const scrollRef = useScrollRestoration({
  scrollId: `panel-name-${docId.id}`,
  getStorageKey: () => getRouteKey(route),
  debug: true,
})

return <AccessoryContent scrollRef={scrollRef}>...</AccessoryContent>
```

### Web App Panels

**Note**: Web scroll restoration is currently disabled (commented out) pending further fixes. The wrapper hook exists at [frontend/apps/web/app/use-scroll-restoration.ts](frontend/apps/web/app/use-scroll-restoration.ts) but is not actively used.

To re-enable when ready:
- Uncomment `activityScrollRef` in `document.tsx`
- Uncomment `scrollRef` usage in `WebDiscussionsPanel`
- Uncomment filter reset effect in `document.tsx`
- Add scrollRef props back to Feed and discussion components

### Filter Reset Behavior

Activity and Contacts panels reset scroll when filters change:

```typescript
useEffect(() => {
  if (route.accessory?.key === 'activity' && activityScrollRef.current) {
    const viewport = activityScrollRef.current.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement
    if (viewport) {
      viewport.scrollTo({top: 0, behavior: 'instant'})
    }
  }
}, [route.accessory?.filterEventType])
```

## Known Limitations

### Infinite Scroll Interaction

The Feed component uses infinite scroll (TanStack Query). Current behavior:
- **When cache is warm**: Perfect restoration (most common case)
- **When cache is cold**: Scroll position may be clamped to available content
- **Graceful degradation**: IntersectionObserver auto-loads more content as user scrolls

Future enhancement option: Progressive restoration that fetches pages until scroll position is reachable.

## Storage Keys

Desktop examples:
- `scroll-activity-hm://z6Mkv...AVdk-document:z6Mkv...AVdk:`
- `scroll-discussions-hm://z6Mkv...AVdk-document:z6Mkv...AVdk/path:discussions`
- `scroll-feed-scroll-feed:z6Mkv...AVdk:`

Keys include:
- Panel identifier (scrollId)
- Route key (changes with navigation)

## Debugging

Filter console with `SCROLL_RESTORE` to see:
- Container ref attachment
- Effect execution
- Scroll position saves (throttled to 500ms logs)
- Scroll position restoration
- Cleanup on unmount

Example logs:
```
[SCROLL_RESTORE:activity-{docId}] Container ref set, viewport: true
[SCROLL_RESTORE:activity-{docId}] Effect running {...}
[SCROLL_RESTORE:activity-{docId}] Restoring scroll position {...}
[SCROLL_RESTORE:activity-{docId}] Saving scroll position {...}
```
