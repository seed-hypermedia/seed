# Scroll Implementation Fix - Step-by-Step Plan

## Overview

**Goal**: Simplify scroll architecture
- **Desktop**: Panel-based scroll (custom containers)
- **Mobile**: Native body scroll with drawer overlays

## Confirmed Requirements

✅ Keep auto-hide header on mobile (hide UP when scrolling down)
✅ Auto-hide MobileInteractionCardCollapsed (hide DOWN when scrolling down)
✅ Both use same scroll detection logic, different hide directions
✅ Use Remix's native ScrollRestoration on mobile
✅ Keep custom scroll restoration on desktop
✅ Block references scroll the body on mobile
✅ Drawer panels keep their own ScrollArea for internal content

---

## Step 1: Refactor useAutoHideSiteHeader for Both Header and Mobile Bar

**File**: `frontend/apps/web/app/web-site-header.tsx` (around line 725)

**Changes**:
- Add `media` query detection (useMedia)
- **Desktop (gtSm)**: Keep current implementation (container scroll listener)
- **Mobile (!gtSm)**: Use `window` scroll listener instead
- Keep scroll direction tracking logic the same
- Return TWO classNames:
  - `hideSiteHeaderClassName` - translates UP (for header)
  - `hideMobileBarClassName` - translates DOWN (for bottom bar)

**Implementation Approach**:
```tsx
export function useAutoHideSiteHeader(scrollContainerRef?: RefObject<HTMLElement>) {
  const media = useMedia()
  const [isHidden, setIsHidden] = useState(false)
  // ... scroll direction tracking logic

  useEffect(() => {
    const target = media.gtSm && scrollContainerRef?.current
      ? scrollContainerRef.current
      : window

    // Attach scroll listener to appropriate target
    // Update isHidden based on scroll direction
  }, [media.gtSm, scrollContainerRef])

  return {
    hideSiteHeaderClassName: isHidden ? '-translate-y-full' : 'translate-y-0',
    hideMobileBarClassName: isHidden ? 'translate-y-full' : 'translate-y-0',
    onScroll, // Keep for backward compatibility
  }
}
```

**Why**:
- Single source of scroll detection logic
- Same scroll direction detection
- Different CSS transforms for different elements
- Works with both container scroll (desktop) and window scroll (mobile)

---

## Step 2: Conditional Scroll Container

**File**: `frontend/apps/web/app/document.tsx` (lines 647-650)

**Current**:
```tsx
<div className="flex flex-1 flex-col overflow-y-auto" ref={mainScrollRef}>
```

**Change to**:
```tsx
<div
  className={cn(
    "flex flex-1 flex-col",
    media.gtSm && "overflow-y-auto"
  )}
  ref={media.gtSm ? mainScrollRef : null}
>
```

**Why**: Desktop uses custom scroll container, mobile uses body scroll

---

## Step 3: Update useAutoHideSiteHeader Usage

**File**: `frontend/apps/web/app/document.tsx` (line 191)

**Current**:
```tsx
const {hideSiteBarClassName, onScroll} = useAutoHideSiteHeader()
```

**Change to**:
```tsx
const {hideSiteHeaderClassName, hideMobileBarClassName} = useAutoHideSiteHeader(
  media.gtSm ? mainScrollRef : undefined
)
```

**Why**: Pass the scroll container ref on desktop, let hook use window on mobile

---

## Step 4: Remove Manual Scroll Event Listener

**File**: `frontend/apps/web/app/document.tsx` (lines 194-202)

**Action**: Delete entire useEffect that attaches onScroll listener

**Why**: Hook now handles scroll listening internally for both desktop and mobile

---

## Step 5: Update WebSiteHeader with New ClassName

**File**: `frontend/apps/web/app/document.tsx` (line 613)

**Current**:
```tsx
<WebSiteHeader
  hideSiteBarClassName={hideSiteBarClassName}
  // ...
/>
```

**Change to**:
```tsx
<WebSiteHeader
  hideSiteBarClassName={hideSiteHeaderClassName}
  // ...
/>
```

**Why**: Use the new className from refactored hook

---

## Step 6: Remove Body Scroll Lock

**File**: `frontend/apps/web/app/document.tsx` (lines 358-376)

**Action**: Delete entire useEffect that locks body scroll

**Why**:
- No longer needed - mobile uses body scroll normally
- Drawer overlay doesn't need to lock body
- Body can scroll underneath drawer

---

## Step 7: Simplify Panel Collapse Logic

**File**: `frontend/apps/web/app/document.tsx` (lines 209-226)

**Current**: Complex collapse/expand logic for mobile

**Change**: Keep only desktop resize logic

```tsx
useEffect(() => {
  if (!media.gtSm || !panel) return

  const mainPanel = mainPanelRef.current
  if (!mainPanel) return

  mainPanel.resize(DEFAULT_MAIN_PANEL_SIZE)
  mainPanel.expand()
}, [panel, media.gtSm])
```

**Why**: Mobile doesn't use Panel system (uses fixed drawer), no collapse needed

---

## Step 8: Conditional Scroll Restoration

**File**: `frontend/apps/web/app/document.tsx` (line 185)

**Current**:
```tsx
const mainScrollRef = useScrollRestoration('main-document-scroll', true)
```

**Change**:
```tsx
const mainScrollRef = media.gtSm
  ? useScrollRestoration('main-document-scroll', true)
  : {current: null} // Let Remix handle restoration on mobile
```

**Why**:
- Desktop needs custom restoration (custom scroll container)
- Mobile uses Remix's native ScrollRestoration (already in root.tsx)

---

## Step 9: Update scrollIntoView Calls

**File**: `frontend/apps/web/app/document.tsx`

**Locations**:
- Lines 382-384 (onActivateBlock)
- Lines 775-783 (onBlockSelect)

**Current**: Always uses scrollIntoView

**Change**: Make container-aware (though scrollIntoView works the same for both)

```tsx
// onActivateBlock - line 382
const targetElement = window.document.getElementById(blockId)
if (targetElement) {
  targetElement.scrollIntoView({behavior: 'smooth', block: 'start'})
}
// Works for both desktop container and mobile body scroll
```

**Note**: scrollIntoView automatically uses the correct scroll context, so minimal changes needed. Just ensure it's called correctly.

**Why**: Verify scroll behavior works correctly in both contexts

---

## Step 10: Update Mobile Drawer Structure

**File**: `frontend/apps/web/app/document.tsx` (lines 898-941)

**Current**: Fixed overlay with translate-y

**Keep**: Current structure is correct

**Verify**:
- Panel content inside drawer keeps ScrollArea ✅
- Drawer has overflow-hidden on wrapper ✅ (line 900)
- Drawer content div can scroll independently ✅ (line 938)

**No changes needed** - drawer structure is already correct for independent scrolling

**Why**: Drawer scrolls independently, body scrolls underneath

---

## Step 11: Apply Auto-Hide to MobileInteractionCardCollapsed

**File**: `frontend/apps/web/app/document.tsx` (lines 1009-1064)

**Changes**:
- Use the `hideMobileBarClassName` from Step 3
- Add transition-transform to the container

**Current**:
```tsx
<div
  className="dark:bg-background border-sidebar-border fixed right-0 bottom-0 left-0 z-40 flex items-center justify-between rounded-t-md border bg-white p-2"
  style={{
    boxShadow: '0px -16px 40px 8px rgba(0,0,0,0.1)',
  }}
>
```

**Change to**:
```tsx
<div
  className={cn(
    "dark:bg-background border-sidebar-border fixed right-0 bottom-0 left-0 z-40 flex items-center justify-between rounded-t-md border bg-white p-2",
    "transition-transform duration-200",
    hideMobileBarClassName
  )}
  style={{
    boxShadow: '0px -16px 40px 8px rgba(0,0,0,0.1)',
  }}
>
```

**Why**: Hide bottom bar DOWN when scrolling down, show when scrolling up

---

## Step 12: Remove Overflow from Page Wrapper (Mobile Only)

**File**: `frontend/apps/web/app/document.tsx` (line 612)

**Current**:
```tsx
<div className="bg-panel flex h-screen max-h-screen min-h-svh w-screen flex-col overflow-hidden">
```

**Change**:
```tsx
<div className={cn(
  "bg-panel flex w-screen flex-col",
  media.gtSm
    ? "h-screen max-h-screen overflow-hidden"
    : "min-h-svh"
)}>
```

**Why**:
- Mobile needs body to scroll (remove overflow-hidden and height constraints)
- Desktop needs constrained height for Panel system

---

## Step 13: Testing Checklist

### Desktop (gtSm)
- [ ] Panel resize works
- [ ] Scroll within panels works
- [ ] Auto-hide header works (hides UP on scroll down)
- [ ] Outline navigation scrolls smoothly within container
- [ ] Block reference navigation scrolls within container
- [ ] Scroll position restores on back/forward navigation
- [ ] Activity/Discussions panels scroll independently
- [ ] No scroll jumping or jank

### Mobile (!gtSm)
- [ ] Body scrolls naturally (no custom scroll container)
- [ ] Header auto-hides UP on scroll down
- [ ] Bottom bar auto-hides DOWN on scroll down
- [ ] Both header and bar show on scroll up
- [ ] Drawer opens/closes smoothly
- [ ] Drawer content scrolls independently
- [ ] Body scrolls underneath drawer (no body lock)
- [ ] Outline navigation scrolls body smoothly
- [ ] Block reference navigation scrolls body smoothly
- [ ] Browser back/forward restores scroll position (Remix native)
- [ ] No scroll jumping or conflicts
- [ ] No overflow-hidden preventing scroll

---

## Implementation Notes

### Order of Implementation
1. **Start with Step 1** (refactor hook) - establishes foundation
2. **Steps 2-5** - update scroll container and hook usage
3. **Steps 6-7** - clean up mobile-specific code
4. **Steps 8-9** - handle scroll restoration and navigation
5. **Steps 10-12** - finalize mobile experience
6. **Step 13** - comprehensive testing

### Key Architecture Changes

**Before**:
- Custom scroll container on both desktop and mobile
- Body scroll lock on mobile when panel opens
- Complex panel collapse logic
- Manual scroll event listener attachment

**After**:
- Desktop: Custom scroll container (unchanged)
- Mobile: Native body scroll
- No body scroll lock needed
- Unified auto-hide logic for header and mobile bar
- Simplified panel logic (desktop only)

### Dependencies
- Remix's `<ScrollRestoration />` in root.tsx (already present)
- `useMedia` hook for responsive detection
- `react-resizable-panels` for desktop Panel system
- Custom `useScrollRestoration` for desktop only

### Potential Issues to Watch For
1. **Scroll restoration conflicts**: Ensure custom hook doesn't run on mobile
2. **scrollIntoView behavior**: May need adjustments if container context matters
3. **Drawer z-index**: Ensure drawer stays above content when body scrolls
4. **Auto-hide timing**: Both header and bar should feel synchronized
5. **Touch events**: Test on actual mobile devices for smooth scrolling

---

## Success Criteria

✅ Desktop maintains current scroll behavior (no regressions)
✅ Mobile uses natural body scroll (feels like native app)
✅ Header and bottom bar auto-hide synchronously
✅ No scroll conflicts or jumping
✅ Scroll position restores correctly on navigation
✅ Drawer scrolls independently from body
✅ ~150 lines of code removed (body lock, complex panel logic, etc.)
✅ Improved performance on mobile (less JS, native scroll)

---

## Questions/Clarifications Needed

Before starting implementation:
1. Should auto-hide behavior have a scroll threshold (e.g., only hide after scrolling X pixels)?
2. Should auto-hide be disabled when near top/bottom of page?
3. Any specific timing/easing preferences for hide/show transitions?
4. Should we keep commented-out scroll restoration code for panels or remove it?

---

## Related Files Reference

- `frontend/apps/web/app/document.tsx` - Main document page (primary changes)
- `frontend/apps/web/app/web-site-header.tsx` - Auto-hide hook (refactor needed)
- `frontend/apps/web/app/root.tsx` - Remix ScrollRestoration (verify present)
- `frontend/apps/web/app/use-scroll-restoration.ts` - Custom scroll restoration wrapper
- `frontend/packages/ui/src/use-scroll-restoration.ts` - Base scroll restoration implementation

---

**Ready to start implementation when you confirm the plan!**
