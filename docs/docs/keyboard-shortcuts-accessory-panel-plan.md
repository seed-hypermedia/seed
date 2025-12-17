# Keyboard Shortcuts: Accessory Panel Toggle - Phase 2 Implementation Plan

## Overview

Phase 2 implements numbered keyboard shortcuts (`CommandOrControl+1`, `CommandOrControl+2`, etc.) to toggle accessory panels. Uses static registration (like Phase 1) with renderer-side guard checks for simplicity.

## Goals

1. Register shortcuts statically on window focus (Cmd+1 through Cmd+5)
2. Map shortcuts to accessory order via index
3. Validate navigation in renderer before committing (guard check)
4. Handle edge cases (no accessories, already open, etc.)

## Architecture: Static Registration with Renderer Guards

### Flow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Main Process: Window gains focus                            │
│    browserWindow.on('focus', () => {                            │
│      // Register all numbered shortcuts (Cmd+1 to Cmd+5)        │
│      for (let i = 1; i <= 5; i++) {                             │
│        globalShortcut.register(`CommandOrControl+${i}`, ...)    │
│      }                                                           │
│    })                                                            │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. User presses shortcut (e.g., Cmd+2)                         │
│    → Main process dispatches event to focused renderer          │
│    dispatchFocusedWindowAppEvent({                              │
│      type: 'toggle_accessory',                                  │
│      index: 1  // 0-based index                                 │
│    })                                                            │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Renderer: Listen for toggle_accessory event                 │
│    useListenAppEvent('toggle_accessory', (event) => {...})      │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Renderer: Navigation guard check                            │
│    const accessory = accessoryOptions[event.index]              │
│    if (!accessory) return // Not available, do nothing          │
│                                                                  │
│    - Check if already open → close it                           │
│    - Otherwise → navigate to accessory                          │
└─────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Main Process: Window loses focus                            │
│    browserWindow.on('blur', () => {                             │
│      // Unregister all numbered shortcuts                       │
│      for (let i = 1; i <= 5; i++) {                             │
│        globalShortcut.unregister(`CommandOrControl+${i}`)       │
│      }                                                           │
│    })                                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Advantages

- ✅ **Simple**: No IPC communication for registration
- ✅ **Robust**: No state synchronization between main/renderer
- ✅ **Consistent**: Follows Phase 1 pattern (like Cmd+B, Cmd+F)
- ✅ **Maintainable**: Renderer is single source of truth for validity
- ✅ **No race conditions**: Shortcuts always registered, renderer decides action

## Implementation Details

### 1. Event Type Updates

**File:** `frontend/apps/desktop/src/utils/window-events.ts`

```typescript
export type AppWindowEvent =
  | {type: 'back'}
  | {type: 'forward'}
  // ... existing events
  | {type: 'toggle_sidebar'}
  | {type: 'toggle_accessory'; index: number}  // NEW - 0-based index
```

### 2. Main Process: Static Shortcut Registration

**File:** `frontend/apps/desktop/src/app-windows.ts`

Modify focus/blur handlers to register all numbered shortcuts statically:

```typescript
browserWindow.on('focus', () => {
  lastFocusedWindowId = windowId
  windowFocused(windowId)
  const navState = windowNavState[windowId]
  const activeRoute = navState
    ? navState.routes[navState.routeIndex]
    : undefined
  if (activeRoute) {
    updateRecentRoute(activeRoute)
  }

  // Register static shortcuts (existing)
  globalShortcut.register('CommandOrControl+F', () => {
    const focusedWindow = getLastFocusedWindow()
    // ... existing Cmd+F logic
  })

  globalShortcut.register('CommandOrControl+B', () => {
    dispatchFocusedWindowAppEvent({type: 'toggle_sidebar'})
  })

  // Register numbered shortcuts for accessories (NEW)
  for (let i = 1; i <= 5; i++) {
    globalShortcut.register(`CommandOrControl+${i}`, () => {
      dispatchFocusedWindowAppEvent({
        type: 'toggle_accessory',
        index: i - 1, // 0-based index
      })
    })
  }
})

browserWindow.on('blur', () => {
  windowBlurred(windowId)

  // Unregister all shortcuts
  globalShortcut.unregister('CommandOrControl+F')
  globalShortcut.unregister('CommandOrControl+B')

  // Unregister numbered shortcuts
  for (let i = 1; i <= 5; i++) {
    globalShortcut.unregister(`CommandOrControl+${i}`)
  }
})
```

### 3. Renderer: Event Listener with Navigation Guard

**File:** `frontend/apps/desktop/src/pages/document.tsx` (or similar component)

Add event listener that checks accessory availability before acting:

```typescript
import {useListenAppEvent} from '@/utils/window-events'
import {useNavigate} from '@/utils/useNavigate'

export function DocumentPage() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const {accessoryOptions} = useDocumentAccessory(/* ... */)

  useListenAppEvent('toggle_accessory', (event) => {
    // Navigation guard: Check if accessory exists at this index
    const targetAccessory = accessoryOptions[event.index]

    if (!targetAccessory) {
      // No accessory at this index, do nothing
      return
    }

    // Get current accessory key
    const currentAccessoryKey = route.key === 'document' || route.key === 'draft'
      ? route.accessory?.key
      : undefined

    if (currentAccessoryKey === targetAccessory.key) {
      // Already open → close it
      replace({
        ...route,
        accessory: undefined,
      })
    } else {
      // Not open → open it
      replace({
        ...route,
        accessory: {key: targetAccessory.key},
      })
    }
  })

  // ... rest of component
}
```

## Edge Cases & Considerations

### 1. Maximum Shortcuts
- Limit to 5 accessories (Cmd+1 through Cmd+5)
- All current accessories fit within this limit (4-5 total)
- Display shortcuts in UI tooltips for discoverability (e.g., "Activity ⌘1")

### 2. Route Transitions
- Shortcuts always registered when window focused
- Renderer checks if accessory available at pressed index
- If route doesn't support accessories, shortcuts silently do nothing
- No cleanup needed on route change - guard handles it

### 3. Window Management
- Each window has shortcuts registered independently
- Shortcuts unregister on window blur
- Re-register on window focus
- No cross-window state to manage

### 4. Error Handling
- Guard against out-of-bounds index (returns early if no accessory)
- No IPC communication to fail
- Graceful degradation if accessory navigation fails

### 5. Accessibility & Discoverability
- Show keyboard hints in accessory tabs (e.g., "Activity ⌘1", "Discussions ⌘2")
- Consider tooltip on hover showing shortcut number
- Optional: Add View menu items for common accessories

## Menu Integration (Optional Enhancement)

**File:** `frontend/apps/desktop/src/app-menu.ts`

Optionally add static menu items for accessories:

```typescript
// In View menu, after Toggle Sidebar:
{
  label: 'Accessories',
  submenu: [
    {
      label: 'Toggle First Accessory',
      accelerator: 'CmdOrCtrl+1',
      click: () => {
        dispatchFocusedWindowAppEvent({type: 'toggle_accessory', index: 0})
      },
    },
    {
      label: 'Toggle Second Accessory',
      accelerator: 'CmdOrCtrl+2',
      click: () => {
        dispatchFocusedWindowAppEvent({type: 'toggle_accessory', index: 1})
      },
    },
    // ... additional menu items for Cmd+3 through Cmd+5
  ],
}
```

**Note:** Since accessory order can vary by route, menu items use generic labels. The renderer's guard check ensures correct behavior.

## Testing Checklist

- [ ] Shortcuts register when window gains focus
- [ ] Pressing Cmd+1 toggles first accessory (if available)
- [ ] Pressing Cmd+2 toggles second accessory (if available)
- [ ] Pressing Cmd+3-5 toggles respective accessories (if available)
- [ ] Shortcuts do nothing when no accessory at that index
- [ ] Toggle works: opens accessory when closed, closes when open
- [ ] Navigation guard silently ignores unavailable accessories
- [ ] Multiple windows maintain independent shortcut state
- [ ] Shortcuts unregister on window blur
- [ ] Shortcuts re-register on window focus
- [ ] No conflicts with existing shortcuts (Cmd+B, Cmd+F, etc.)
- [ ] Works across different route types (document, draft, feed, etc.)
- [ ] Works across different accessory types (activity, discussions, collaborators, directory, options, etc.)

## Performance Considerations

- globalShortcut registration is fast and synchronous
- No IPC communication overhead
- No re-registration on route changes
- Renderer guard check is lightweight (array index lookup)

## Future Enhancements

1. **Customizable Shortcuts**: Allow users to configure preferred shortcuts
2. **Shortcut Hints in UI**: Display active shortcuts in accessory tabs
3. **Cycle Through Accessories**: Add Cmd+Shift+A to cycle through available accessories
4. **Conflict Detection**: Warn if user customization conflicts with system shortcuts

## Implementation Steps

1. **Add event type** - Update `AppWindowEvent` with `toggle_accessory` type
2. **Register shortcuts** - Add loop in `app-windows.ts` focus handler to register Cmd+1 through Cmd+5
3. **Unregister shortcuts** - Add loop in blur handler to clean up
4. **Add event listener** - Add `useListenAppEvent` in document/draft pages with guard logic
5. **Test** - Verify shortcuts work across routes and window states
6. **Add UI hints** (optional) - Show shortcut numbers in accessory tabs
7. **Document** - Update user-facing help/docs with new shortcuts
