# Sidebar Preferences

## Problem

The sidebar has no memory. Every time the app restarts, all sections expand, items revert to backend-driven activity sort, and there's no way to hide sections the user doesn't care about. Users with many subscriptions and contacts have a cluttered sidebar they can't organize. There's also no way to reorder sections or items — the layout is fully hardcoded.

Specific pain points:
- Collapse state resets on reload (stored as `React.useState(false)`)
- Item ordering is always "by recent activity" from the backend — no alphabetical or manual option
- Users can't hide sections they don't use (e.g., someone who doesn't use Following)
- Section order is hardcoded in JSX — no way to prioritize what matters
- Library and Drafts are pinned in the footer with no visibility control

## Solution

A `UIPreferences-v001` key in electron-store persists sidebar preferences globally (same across all windows). Follows the existing `Bookmarks-v001`, `Settings-v001` pattern.

**What users get:**
- Collapse state persists across restarts
- Per-section sort mode (activity/alphabetical/manual) toggled via icon in section header
- Drag-and-drop to reorder items within any section — dragging in any sort mode locks the current order and switches to manual
- Drag-and-drop to reorder sections directly in the sidebar
- Visibility toggles in Settings > General > Sidebar
- Reset to defaults button
- Drop indicator line (primary color) shows exact insertion point during DnD

**How it works with live data:**
- `itemOrder` stores stable string IDs, reconciled with live API data via `mergeWithUserOrder()`: new items at the end, removed items silently dropped
- `itemOrder` written only on explicit DnD drop, never auto-updated
- Switching away from manual preserves `itemOrder` so the user can return

**Sort mode transitions:**
- manual -> activity/alphabetical: `itemOrder` preserved
- activity/alphabetical -> manual (via icon): restores saved `itemOrder`, or locks current order if none
- Drag in any mode: locks current display order + drag as new `itemOrder`, sets manual

## Architecture

### Files created
- `frontend/apps/desktop/src/app-ui-preferences.ts` — Main process tRPC router (electron-store persistence)
- `frontend/apps/desktop/src/models/ui-preferences.ts` — Renderer React Query hooks
- `frontend/apps/desktop/src/utils/merge-user-order.ts` — Pure utility for reconciling user order with live data
- `frontend/apps/desktop/src/utils/merge-user-order.test.ts` — Unit tests

### Files modified
- `frontend/apps/desktop/src/app-api.ts` — Registered `uiPreferences` router
- `frontend/packages/shared/src/models/query-keys.ts` — Added `UI_PREFERENCES` key
- `frontend/apps/desktop/src/components/sidebar.tsx` — Persistent collapse, sort icons, visibility, section ordering, DnD with drop indicators
- `frontend/apps/desktop/src/pages/settings.tsx` — Sidebar visibility toggles + reset in General Settings

### Schema

```typescript
type SidebarSectionId = 'joined-sites' | 'following' | 'bookmarks' | 'library' | 'drafts'

type SidebarSectionPrefs = {
  collapsed: boolean
  visible: boolean
  sortMode: 'activity' | 'alphabetical' | 'manual'
  itemOrder: string[]
}

type UIPreferencesState = {
  sidebar: {
    sectionOrder: SidebarSectionId[]
    sections: Partial<Record<SidebarSectionId, Partial<SidebarSectionPrefs>>>
  }
}
```

### DnD stack
- `@atlaskit/pragmatic-drag-and-drop` (already in repo)
- `@atlaskit/pragmatic-drag-and-drop-hitbox` (added) — closest-edge detection + `getReorderDestinationIndex`
- Drop indicator: custom `DropIndicatorLine` component using `bg-primary` absolute-positioned line

## Rabbit Holes

- **Syncing preferences across devices**: Local-only electron-store. Cross-device sync needs a backend service and conflict resolution — not now.
- **Per-window sidebar layout**: Decided global. Per-window means duplicating into `WindowState-v004` and handling divergence.
- **Animating drag-and-drop**: pragmatic-drag-and-drop supports it but variable-height sidebar items make it fiddly. Start without, add later.
- **Undo for accidental drag**: Cycling sort back to activity/alphabetical effectively undoes it. No separate undo system.
- **Complex sort options** (by date joined, by doc count, etc.): Activity + alphabetical covers 95%. More can be added later without schema changes.
- **Keyboard-accessible reordering**: pragmatic-drag-and-drop has a11y features but proper wiring is non-trivial. Defer.

## No Goes

- **My Site section customization**: Always visible, always first — it's identity context.
- **Web app support**: Desktop-only (electron-store). Web uses localStorage/IndexedDB. Revisit independently.
- **Sidebar section creation**: No custom sections or widgets.
- **Per-section column layouts**: Items are always a vertical list — no grid/card views.
- **Drag items between sections**: Semantically doesn't make sense (subscription != bookmark). DnD is within-section only.
- **Search/filter within sidebar sections**: Separate feature, orthogonal to preferences.
