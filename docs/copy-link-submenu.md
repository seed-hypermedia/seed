# Copy Link Submenu

## Problem

The three-dot options menu in the document tools header and document card embed has a single "Copy Link" action that copies the canonical URL. Users have no way to choose between the canonical URL, a gateway-specific URL, or the `hm://` hypermedia protocol URL. Different contexts require different URL formats (sharing, embedding, protocol-based interop), and each copy requires manually constructing the right URL.

## Solution

Replace the single "Copy Link" item with a submenu offering three copy options:

- **Copy Canonical URL** — the existing behavior (custom domain URL when set, gateway URL otherwise). Triggers push-after-action on desktop.
- **Copy Gateway URL** — explicitly formats the URL using the app's configured gateway hostname, regardless of custom domain. Also triggers push-after-action.
- **Copy Hypermedia URL** — copies the `hm://` protocol URL. No push needed.

The submenu uses the existing Radix `DropdownMenuSub`/`SubTrigger`/`SubContent` infrastructure already available in the codebase.

### Sub-menu Item Icons

| Option | Icon |
|--------|------|
| Copy Canonical URL | `Globe` |
| Copy Gateway URL | `Link` |
| Copy Hypermedia URL | `Link2` |

<!-- TODO: Add screenshot of the expanded submenu in the document tools header -->

### Files Changed

| File | Change |
|------|--------|
| `frontend/packages/ui/src/options-dropdown.tsx` | Extended `MenuItemType` with `children`; rendered submenus for items with children |
| `frontend/packages/ui/src/resource-page-common.tsx` | Replaced flat copy-link in `useCommonMenuItems` with submenu (3 children) |
| `frontend/packages/ui/src/newspaper.tsx` | Same submenu in `DocumentCard` |
| `frontend/packages/ui/src/document-list-item.tsx` | Same submenu in `DocumentListItem` |
| `frontend/apps/web/app/web-utils.tsx` | Removed redundant "Copy Link" + "Copy {gateway} Link" items (now covered by submenu) |
| `frontend/apps/desktop/src/components/titlebar-common.tsx` | Stubbed dead `DocOptionsButton` (three-dot button was already removed from titlebar) |

## Scope

Implementation took approximately **2 hours**. Breakdown:

| Phase | Time |
|-------|------|
| Codebase exploration & planning | 30 min |
| OptionsDropdown submenu support | 15 min |
| `useCommonMenuItems` submenu | 20 min |
| `DocumentCard` + `DocumentListItem` | 20 min |
| Cleanup (`web-utils.tsx`, `titlebar-common.tsx`) | 15 min |
| Typecheck & fixes | 20 min |

## Rabbit Holes

- **`ChevronRight` import**: The Radix `DropdownMenuSubTrigger` already renders its own chevron icon (`ChevronRightIcon`), so no manual icon import was needed.
- **Import paths for URL builders**: `createWebHMUrl` and `hmIdToURL` live in `@shm/shared/utils/entity-id-url`, NOT re-exported from `@shm/shared`. Had to fix incorrect imports.
- **titlebar-cleanup imports**: The `titlebar-common.tsx` file shares imports between `DocOptionsButton` and other functions (`NotificationButton`, `TitlebarPopover`, etc.). Sloppy removal breaks the whole file — need to carefully preserve imports used by remaining functions.
- **Push-after-action**: Only "Canonical" and "Gateway" options trigger `onPushReference`. The "Hypermedia" option doesn't (it's a protocol URL with no web resolver).

## No-Gos

- **Desktop titlebar three-dot button** was already removed from the UI. The `DocOptionsButton` component was stubbed to return `null` rather than fully deleted, in case a future UI re-adds it.
- **Web header "What's New" page** previously had its own "Copy Link" + "Copy {gateway} Link" items in `useWebMenuItems`. These were removed — the submenu in `useCommonMenuItems` now handles all copy needs.
- **No changes to `@shm/shared/gateway-url.ts`**: The origin/gateway URL is accessed via `useUniversalAppContext().origin`, which is already set correctly by both desktop and web providers. No need to fix the gateway URL stream.
- **No new files** were created — all changes are in-place modifications to existing files.
