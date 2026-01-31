# Phase 4: Mobile Layout Support

## Objective
Add mobile-specific UI to the shared ResourcePage: mobile interaction bar (bottom bar), mobile panel sheet, and auto-hide header.

## Current State

The shared `ResourcePage` in `resource-page-common.tsx` already has:
- Mobile detection via `useMedia()` → `media.xs`
- Document scroll on mobile (line 547-552) vs element scroll on desktop
- No panels render on mobile yet (intentionally skipped)

Components in legacy that can be extracted:
- `MobileInteractionCardCollapsed` in `web-legacy-document.tsx` (lines 992-1100+)
- `useAutoHideSiteHeader()` in `site-header.tsx`

## Scope

### In Scope
- Extract and integrate `MobileInteractionBar` from legacy
- Build `MobilePanelSheet` for opening panels on mobile
- Wire up auto-hide header behavior for mobile
- Add mobile bottom bar padding

### Out of Scope
- Desktop (already working)
- Creating new context providers (use existing `useMedia()`)

---

## Implementation Steps

### Step 4.1: Extract Mobile Interaction Bar

**File**: `frontend/packages/ui/src/mobile-interaction-bar.tsx`

Extract from `web-legacy-document.tsx` (lines 992-1100+) into a standalone component.

Key changes from legacy:
- Make it platform-agnostic (pass callbacks instead of using web-specific hooks)
- Accept `docId`, `commentsCount`, `onCommentsClick` as props
- Keep avatar/feed button behavior as is

```typescript
interface MobileInteractionBarProps {
  docId: UnpackedHypermediaId
  commentsCount: number
  onCommentsClick: () => void
  hideMobileBarClassName?: string
}
```

### Step 4.2: Create Mobile Panel Sheet

**File**: `frontend/packages/ui/src/mobile-panel-sheet.tsx`

Full-screen slide-up overlay for panels on mobile:

```typescript
interface MobilePanelSheetProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children: ReactNode
}
```

Features:
- Slide up from bottom with animation
- Header with title and close button
- Scrollable content area

### Step 4.3: Update ResourcePage for Mobile

**File**: `frontend/packages/ui/src/resource-page-common.tsx`

Changes to `DocumentBody`:

```typescript
// Add state for mobile panel
const [mobilePanelOpen, setMobilePanelOpen] = useState(false)

// In mobile section (around line 547):
if (isMobile) {
  return (
    <>
      <div className="relative flex flex-1 flex-col pb-16" ref={elementRef}>
        {mainPageContent}
      </div>

      {/* Mobile bottom bar */}
      <MobileInteractionBar
        docId={docId}
        commentsCount={interactionSummary.data?.comments || 0}
        onCommentsClick={() => setMobilePanelOpen(true)}
      />

      {/* Mobile panel sheet */}
      <MobilePanelSheet
        isOpen={mobilePanelOpen}
        title={getPanelTitle(panelKey)}
        onClose={() => setMobilePanelOpen(false)}
      >
        <PanelContentRenderer ... />
      </MobilePanelSheet>
    </>
  )
}
```

### Step 4.4: Wire Auto-Hide Header

The `SiteHeader` already has auto-hide support. We need to ensure it's enabled on mobile.

Check `site-header.tsx` for `useAutoHideSiteHeader()` - if it's already called internally, no changes needed. If not, may need to pass a prop.

---

## Testing Checklist

### Mobile (< 640px width in browser devtools)

1. **Mobile Interaction Bar**
   - [ ] Bar shows at bottom of screen
   - [ ] Avatar displays correctly
   - [ ] Feed button navigates to feed
   - [ ] Comments button opens mobile panel

2. **Mobile Panel Sheet**
   - [ ] Opens when clicking comments button
   - [ ] Shows correct panel content
   - [ ] Close button works
   - [ ] Slides down on close

3. **Scroll Behavior**
   - [ ] Main content scrolls via document scroll
   - [ ] Bottom bar stays fixed
   - [ ] Header auto-hides on scroll down
   - [ ] Header shows on scroll up

4. **All View Tabs**
   - [ ] Activity tab scrolls correctly
   - [ ] Discussions tab scrolls correctly
   - [ ] Directory tab renders properly

### Desktop Regression
- [ ] Desktop layout unchanged
- [ ] Desktop panels work
- [ ] No mobile components on desktop

---

## Files

| File | Type | Purpose |
|------|------|---------|
| `ui/src/mobile-interaction-bar.tsx` | New | Bottom bar component |
| `ui/src/mobile-panel-sheet.tsx` | New | Full-screen panel overlay |
| `ui/src/resource-page-common.tsx` | Modified | Integrate mobile components |
| `ui/src/index.ts` | Modified | Export new components |

---

## Success Criteria

Phase 4 is complete when:
1. Mobile interaction bar shows on small screens
2. Comments button opens mobile panel sheet
3. Panel content renders in sheet
4. Auto-hide header works
5. All view tabs scroll correctly on mobile
6. Desktop unaffected
