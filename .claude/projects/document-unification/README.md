# Document.tsx Unification Project

## Linear Tasks

- **Primary**:
  [SHM-2101](https://linear.app/seedhypermedia/issue/SHM-2101/unify-documenttsx-on-web-and-desktop) -
  Unify document.tsx on web and desktop
- **Related**:
  [SHM-2096](https://linear.app/seedhypermedia/issue/SHM-2096/web-cannot-scroll-on-feed-or-discussions) -
  Web cannot scroll on feed or discussions

## Goal

Merge the two document page implementations (`desktop/src/pages/document.tsx`
and `web/app/document.tsx`) into a single shared implementation at
`frontend/packages/ui/src/resource-page-common.tsx`.

## Current State (Working Copy)

### Files Backed Up (Legacy)

- `frontend/apps/desktop/src/pages/desktop-legacy-document.tsx` - Original
  desktop implementation (~1156 lines)
- `frontend/apps/web/app/web-legacy-document.tsx` - Original web implementation
  (~1262 lines)

### New Shared Implementation

- `frontend/packages/ui/src/resource-page-common.tsx` - Placeholder for unified
  implementation
- `frontend/apps/desktop/src/pages/desktop-resource.tsx` - Desktop wrapper
- `frontend/apps/web/app/resource-web.tsx` - Web wrapper

### Entry Points (Modified)

- `frontend/apps/web/app/routes/$.tsx` - Now renders `<ResourcePage />`
  (line 310)
- `frontend/apps/web/app/routes/_index.tsx` - Now renders `<ResourcePage />`
  (line 56)

---

## Architecture Analysis

### Routing Systems Comparison

| Aspect              | Desktop                                    | Web                                     |
| ------------------- | ------------------------------------------ | --------------------------------------- |
| **History**         | In-memory stack (`routes[]` array)         | Browser History API / Remix             |
| **URL State**       | Base64-encoded route in window opener      | URL path + query params                 |
| **View Terms**      | Encoded in `NavRoute.key`                  | Encoded in URL path (`:activity`)       |
| **Panel Params**    | In `NavRoute.panel` property               | In URL `?panel=key`                     |
| **Navigation Hook** | `useNavigate()` from `@/utils/useNavigate` | `useNavigate()` from `@remix-run/react` |
| **Route Context**   | `useNavRoute()` from `@shm/shared`         | Parsed from URL in loader               |

### Key Navigation Types (from `@shm/shared/routes.ts`)

```typescript
type DocumentPageRoute =
  | DocumentRoute // key: 'document', id, panel?
  | FeedRoute // key: 'feed', id, panel?
  | DirectoryRoute // key: 'directory', id, panel?
  | CollaboratorsRoute // key: 'collaborators', id, panel?
  | ActivityRoute // key: 'activity', id, filterEventType?, panel?
  | DiscussionsRoute // key: 'discussions', id, openComment?, panel?

type DocumentPanelRoute =
  | ActivityRoute
  | DiscussionsRoute
  | DirectoryRoute
  | CollaboratorsRoute
  | DocumentOptionsRoute
```

### Panel Systems Comparison

| Aspect             | Desktop                               | Web                                      |
| ------------------ | ------------------------------------- | ---------------------------------------- |
| **Component**      | `AccessoryLayout` (resizable sidebar) | `PanelGroup` (resizable) + mobile sheet  |
| **Width Storage**  | `state.accessoryWidth` in nav state   | `autoSaveId="web-document"` localStorage |
| **Min Width**      | 480px enforced via `useLayoutEffect`  | 20% min via `PanelGroup`                 |
| **Panel Keys**     | Extracted from `route.panel?.key`     | `activePanel` local state + URL sync     |
| **Selection Hook** | `useDocumentSelection()`              | Local state with `setDocumentPanel()`    |

### Mobile Layout (Web Only)

Web has comprehensive mobile handling:

- `useMedia()` hook with `gtSm` breakpoint (861px)
- `MobileInteractionCardCollapsed` - Fixed bottom bar
- Mobile panel sheet - Full-screen slide-up overlay
- `useAutoHideSiteHeader()` - Auto-hide header on scroll

Desktop doesn't need mobile handling (Electron).

### Main Content Rendering Comparison

Both implementations render similar "main panels":

1. **content** - Document body with `BlocksContent`
2. **directory** - `DirectoryPageContent`
3. **collaborators** - `CollaboratorsPageContent` /
   `ReadOnlyCollaboratorsContent`
4. **activity** - `Feed` component with filters
5. **discussions** - `DiscussionsPageContent`

### Desktop-Specific Features

- `AccessoryLayout` with keyboard shortcuts (`toggle_tool` event for view
  navigation)
- `NotifSettingsDialog` for email notifications
- `useDocumentRead()` for P2P subscription
- `useHackyAuthorsSubscriptions()` for author subscriptions
- `EditDocButton` with popover onboarding
- `CreateDocumentButton` for new sub-documents

### Web-Specific Features

- `WebSiteProvider` context with dehydrated state from SSR
- `useLocalKeyPair()` for web auth
- `WebCommenting` component
- `useScrollRestoration` (custom, not from `@shm/ui`)
- `FocusProvider` for keyboard focus management
- `PageFooter` component
- `MyAccountBubble` component
- Server-side data loading via Remix loader

---

## Unification Strategy

### Approach: Incremental Platform Abstraction

Rather than try to merge everything at once, we'll:

1. Create a shared `ResourcePageCommon` component that handles core rendering
2. Create platform-specific wrappers that provide platform-specific dependencies
3. Progressively migrate features from legacy implementations to shared code
4. Test each phase thoroughly before moving to the next

### Key Principles

1. **Use existing hooks** - Don't create new abstractions. Use `useResource`,
   `useNavRoute`, etc. directly
2. **React Query hydration** - Web pre-hydrates data on server, so `useResource`
   just works
3. **Unified SiteHeader** - The shared `SiteHeader` component works for both
   platforms (delete `WebSiteHeader`)
4. **Platform wrappers** - Desktop/web wrappers handle platform-specific setup
   (providers, context)
5. **Minimal props** - Pass `docId` to `ResourcePage`, let it call hooks
   internally

---

## Phase Overview

| Phase | Focus              | Key Deliverable                           |
| ----- | ------------------ | ----------------------------------------- |
| 1     | Basic Scaffold     | Render document content on both platforms |
| 2     | Navigation/Routing | Unified route handling, view term support |
| 3     | Panel System       | Accessory panels work on both platforms   |
| 4     | Mobile Layout      | Mobile-specific layouts for web           |
| 5     | Feature Parity     | All features from legacy implementations  |
| 6     | Cleanup            | Remove legacy files, final testing        |

---

## Files to Reference

### Legacy Implementations (Backed Up)

- [desktop-legacy-document.tsx](frontend/apps/desktop/src/pages/desktop-legacy-document.tsx)
- [web-legacy-document.tsx](frontend/apps/web/app/web-legacy-document.tsx)

### Shared Types

- [routes.ts](frontend/packages/shared/src/routes.ts)
- [navigation.tsx](frontend/packages/shared/src/utils/navigation.tsx)
- [entity-id-url.ts](frontend/packages/shared/src/utils/entity-id-url.ts)

### Desktop Infrastructure

- [main.tsx](frontend/apps/desktop/src/pages/main.tsx) - Route switching
- [accessory-sidebar.tsx](frontend/apps/desktop/src/components/accessory-sidebar.tsx)
- [document-accessory.tsx](frontend/apps/desktop/src/components/document-accessory.tsx)
- [useNavigate.tsx](frontend/apps/desktop/src/utils/useNavigate.tsx)

### Web Infrastructure

- [routes/$.tsx](frontend/apps/web/app/routes/$.tsx) - Remix catch-all route
- [providers.tsx](frontend/apps/web/app/providers.tsx) - `WebSiteProvider`
- [loaders.ts](frontend/apps/web/app/loaders.ts) - Server-side data loading

### Shared UI Components

- [page-message-states.tsx](frontend/packages/ui/src/page-message-states.tsx) -
  `PageLayout`
- [document-tools.tsx](frontend/packages/ui/src/document-tools.tsx)
- [document-header.tsx](frontend/packages/ui/src/document-header.tsx)
- [document-cover.tsx](frontend/packages/ui/src/document-cover.tsx)
- [blocks-content.tsx](frontend/packages/ui/src/blocks-content.tsx)
- [layout.tsx](frontend/packages/ui/src/layout.tsx) - `useDocumentLayout`

---

## Testing Checklist Template

Each phase should be tested for:

### Desktop

- [ ] App launches without errors
- [ ] Document loads and displays content
- [ ] Navigation between documents works
- [ ] View term routes work (activity, discussions, etc.)
- [ ] Panel opens/closes correctly
- [ ] Keyboard shortcuts work

### Web

- [ ] Page loads without hydration errors
- [ ] SSR works correctly
- [ ] Client-side navigation works
- [ ] View term URLs work (`:activity`, etc.)
- [ ] Panel query params work (`?panel=...`)
- [ ] Mobile layout renders correctly
- [ ] Mobile panel sheet works
- [ ] Scroll restoration works

---

## Important Notes

1. **Don't break both platforms at once** - Always have at least one working
2. **Test thoroughly after each phase** - Don't accumulate breakage
3. **Keep legacy files until final cleanup** - Easy rollback if needed
4. **Watch for hydration mismatches on web** - SSR/client must match
5. **Console errors are warnings** - Watch for them during testing

---

## Phase Documents

### Completed

1. **[Phase 1: Basic Scaffold](phase-1-basic-scaffold.md)** ✓ - SiteHeader +
   BlocksContent rendering on both platforms

### Ready to Implement

2. **[Phase 2: Navigation/Routing](phase-2-navigation-routing.md)** - Add
   DocumentTools tab bar and view switching
3. **[Phase 3: Panel System](phase-3-panel-system.md)** - Unified route-based
   panels (no platform fragmentation)

### Needs Review

4. [Phase 4: Mobile Layout](NEEDS_REVIEW-phase-4-mobile-layout.md) - Implement
   web mobile layouts
5. [Phase 5: Feature Parity](NEEDS_REVIEW-phase-5-feature-parity.md) - All
   remaining features
6. [Phase 6: Cleanup](NEEDS_REVIEW-phase-6-cleanup.md) - Remove legacy, final
   testing

**Note**: Phases 4-6 need review as approach may change based on learnings from
earlier phases.

---

## Quick Commands

```bash
# Run desktop app
./dev run-desktop

# Run web app
yarn web

# Type check
yarn workspace @shm/shared build:types && yarn typecheck

# Format
yarn format:write
```

---

## Agent Instructions

When resuming work on this project:

1. Read this README first
2. Check which phase is currently in progress
3. Read the corresponding phase document
4. Follow the implementation steps
5. Test thoroughly using the checklist
6. Update progress in the phase document

When starting a new phase:

1. Verify previous phase is complete
2. Run full test suite
3. Read the new phase document completely
4. Implement step by step
5. Test after each step

## KNOWN ISSUES - Eric's Notes

- Discussion replies are not being sent as replies, they are starting new
  discussions
- Mobile footer abstraction should also support the join button on web,
  currently missing
- mobile footer should exclude the feed and comments button, we can simplify a
  lot of this code
- Desktop does not have the edit/new doc button.
  - Should support in directory panel as well
- No draft support for desktop yet
- When changing main panel tools, the current accessory should stay open
- Formatting/layout issues
  - desktop background color and border incorrect around site content
  - open in panel button is poorly located
  - scroll issue still not fixed!
- Issues with click-to-select block
- reply button need thouroug testing
- copy link on desktop only appears on the content page, it should appear
  everywhere
