# Branch: feat/nav-refactor

## Summary
Major navigation refactor promoting document panels to first-class pages with full routing support and improved breadcrumb navigation.

## Key Changes

### New Pages (First-Class Routes)
Previously these were only accessible as side panels on documents. Now they're standalone pages:

- **Activity Page** ([activity.tsx](frontend/apps/desktop/src/pages/activity.tsx)) - Shows activity feed for a document/site
- **Collaborators Page** ([collaborators.tsx](frontend/apps/desktop/src/pages/collaborators.tsx)) - Manage document collaborators
- **Directory Page** ([directory.tsx](frontend/apps/desktop/src/pages/directory.tsx)) - Browse child documents

Each page:
- Has its own route schema in [routes.ts](frontend/packages/shared/src/routes.ts)
- Supports panels (other views as sidebars)
- Has full breadcrumb navigation in titlebar
- Handles redirects, not-found, and discovery states

### Routing System Overhaul ([routes.ts](frontend/packages/shared/src/routes.ts))
- New route schemas: `activityRouteSchema`, `collaboratorsRouteSchema`, `directoryRouteSchema`, `discussionsRouteSchema`
- Panel schemas defined separately and reused across page types
- Each page type defines which panels it supports via discriminated unions
- `getRoutePanel()` updated to extract panel routes from all new page types

### Breadcrumb Navigation ([titlebar-title.tsx](frontend/apps/desktop/src/components/titlebar-title.tsx))
- `BreadcrumbTitle` now supports all new page types (directory, collaborators, activity, discussions)
- Shows synthetic panel suffix in breadcrumbs (e.g., "Site / Doc / Directory")
- Breadcrumbs properly render path + current view type

### Shared Page Components ([page-message-states.tsx](frontend/packages/ui/src/page-message-states.tsx))
New shared UI components for consistent page states:
- `PageLayout` - Consistent layout wrapper with fixed header and scrollable content. Supports `centered` prop for constrained content width.
- `PageMessageBox` - Generic message container
- `PageRedirected` - Redirect notice with navigation button
- `PageDiscovery` - Loading state when finding document on network
- `PageNotFound` - Document not found message

### Content Width Constraints
All new pages have centered content with `max-w-[calc(85ch+1em)]` to match the feed page:
- `Feed` component accepts `centered` prop for activity page
- `SelectionContent` (in [accessories.tsx](frontend/packages/ui/src/accessories.tsx)) accepts `centered` prop
- `Discussions`, `CommentDiscussions`, `BlockDiscussions` components all support `centered`
- `PageLayout` centers content when `centered` prop is true

### URL Generation ([entity-id-url.ts](frontend/packages/shared/src/utils/entity-id-url.ts))
- Renamed `createHMUrl` -> `hmIdToURL`
- New `routeToUrl()` function converts NavRoute to shareable URL
- New `getRouteViewTerm()` returns URL suffix for panel views (`:activity`, `:discussions`, etc.)
- `createWebHMUrl` now accepts `viewTerm` parameter

### Copy Link Improvements ([copy-reference-url.tsx](frontend/apps/desktop/src/components/copy-reference-url.tsx))
- `useCopyReferenceUrl` now uses `routeToUrl()` for generating URLs
- Supports copying links to any route type, not just documents

## Stats
- 46 files changed
- +2270 / -992 lines

## Commits
1. Desktop Breadcrumbs
2. Full routes for panels
3. Copy new link formats
4. Directory page + shared page-message-states
5. Collaborators page
6. Activity page
