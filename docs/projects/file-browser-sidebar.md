# Site File Browser Sidebar

## Problem

Sites can contain many documents arranged in a path hierarchy, but readers cannot currently browse that complete
structure while reading a document. The Site Header exposes selected navigation items, and the All Documents page
exposes the full directory, but neither provides persistent, contextual navigation alongside the main site content.

Readers need to see where the current document sits in the site, move between related documents, and narrow a large list
by title without leaving the page. The experience must work consistently across desktop, desktop-sized web, and mobile
web while preserving the existing document authorization behavior.

## Solution

Add a shared File Browser below the Site Header. The browser renders the site's readable documents as an expandable
hierarchy and provides title filtering, active-document context, and responsive containers for wide and mobile layouts.

### User stories

- As a reader, I can browse all site documents that I am authorized to read without leaving the current document.
- As a reader, I can expand and collapse document branches to understand the site's hierarchy.
- As a reader, I can see the active document and its ancestors when I navigate.
- As a reader, I can filter documents by title and quickly navigate to a matching result.
- As an authorized reader, I can identify private documents by a lock shown before their titles.
- As a desktop user, I can resize or collapse the browser and give the main document more space.
- As a mobile user, I can open the same browser in a full-height drawer from the Site Header.

### Shared document browser

- Implement one shared File Browser behavior component in `@shm/ui` for desktop, web, and mobile.
- Query the selected site's root with the existing `useDirectory(siteRootId, {mode: 'AllDescendants'})` flow.
- Render exactly the documents returned by the existing authorization-aware query.
- Do not add a frontend public/private filter. Public-only gateways and authenticated capabilities remain responsible
  for deciding which documents are returned.
- Exclude drafts in this iteration by using `useDirectory`, not `useDirectoryWithDrafts`.
- Reuse the existing `buildDocumentTree` hierarchy utility.
- Use platform-specific containers around the shared behavior:
  - an inline resizable panel for desktop and wide web;
  - an overlay drawer for mobile.

### Hierarchy and navigation

- Render document titles in their path hierarchy.
- Show top-level documents when no branch is expanded.
- Give documents with children an explicit expand/collapse control.
- Automatically expand the ancestor chain of the active document on initialization and route changes.
- Highlight the active document row.
- Preserve unrelated manual expansion choices when the active route changes.
- Selecting a document uses the existing platform navigation abstraction.
- A private document renders a lock icon immediately before its title.
- The lock has an accessible label or tooltip such as `Private document`; the icon is not the only accessible indication
  of privacy.
- Public rows do not reserve an empty icon slot in this iteration.
- Keep the row composition capable of receiving other document icons later, without building a general document-icon
  system now.

### Search

- Place a search input at the top of the File Browser, below its title and controls.
- Match a case-insensitive substring against the displayed document title only.
- Do not search document paths, bodies, authors, or other metadata.
- While a query is present, replace the tree with a flat list of matching documents.
- Hide hierarchy expand/collapse controls in filtered results.
- Display a clear `No documents found` state when there are no matches.
- Clearing the query restores the hierarchical tree and its previous manual expansion state.

### Desktop and wide-web layout

- Position the File Browser below the Site Header and to the left of the main content.
- Show the browser by default.
- Opening and resizing it pushes and resizes the main content; it does not overlay the main content.
- Use the existing `react-resizable-panels` dependency and established panel styling.
- Use these initial sizing constraints:
  - default width: 288 px;
  - minimum width: 240 px;
  - maximum width: 40% of the available content area.
- Put the collapse button in the File Browser header.
- When collapsed, return the available width to the main content and retain a compact affordance for reopening the
  browser.
- Do not persist the open width in local storage, account settings, or desktop window state. A fresh load starts at 288
  px.
- Keep the panel below the Site Header so the site identity and primary site navigation continue to span the complete
  viewport width.

### Mobile layout

- Put the File Browser open button in the Site Header.
- Open a drawer from the left.
- Make the drawer 100% of the viewport height and 80% of the viewport width.
- Render a dismissible backdrop over the remaining 20% of the viewport.
- Mobile content is overlaid, not resized or pushed.
- Use a solid, square-edged surface so the drawer reads as structural navigation rather than a floating modal.
- Use a compact two-line drawer header with the File Browser label, the current site name as secondary text, and an
  explicit close button at the far right.
- Put the search input in a padded section below the header, separated from the header and document list by subtle
  borders.
- Keep the header and search fixed while the document list scrolls independently.
- Apply mobile safe-area padding at the top and bottom.
- Close the drawer after selecting a document.
- Close the drawer on backdrop activation and Escape where a keyboard is available.
- Move focus into the drawer when it opens, trap focus while open, and restore focus to the Site Header trigger when it
  closes.

### Component states

- **Loading:** show a stable skeleton that resembles the search field and document rows without shifting the main
  layout.
- **Loaded:** show the hierarchy or filtered result list.
- **Empty site:** explain that the site has no browsable documents.
- **No search results:** show `No documents found` without replacing the search input.
- **Error:** show a concise directory-loading error with a retry action.
- **Active:** distinguish the current document using existing selection tokens and keep it visible after route changes.
- **Hover, pressed, and focus:** use existing interaction and focus tokens for rows and controls.
- **Reduced motion:** avoid nonessential drawer and expansion motion when reduced motion is requested.

### Accessibility and performance

- Use buttons for expand/collapse actions and links/navigation controls for document activation.
- Provide accessible names for browser open, close, collapse, expand, resize, search, and privacy controls.
- Expose expanded state through `aria-expanded` where appropriate.
- Make the resize handle keyboard operable through the existing panel library behavior.
- Preserve visible focus and logical tab order in both containers.
- Animate expand/collapse to measured content size if animation is used; do not use an arbitrary maximum-height
  technique.
- Build and filter the tree with memoized derivations so ordinary state changes do not repeatedly reconstruct a large
  directory.
- Avoid animating every row in a large hierarchy.

### Acceptance criteria

- Desktop app and desktop-sized web show the File Browser by default below the Site Header.
- The desktop/wide-web browser starts at 288 px, cannot shrink below 240 px, and cannot grow beyond 40% of the content
  area.
- Dragging the divider resizes the browser and main content together.
- Collapsing the browser returns its width to the main content, and it can be reopened.
- Reloading resets the browser to its default width.
- Mobile exposes an open button in the Site Header and opens a full-height, 80%-wide drawer from the left.
- The mobile drawer uses a compact two-line header, separated search section, independently scrolling document list,
  square outer edge, and safe-area padding.
- The hierarchy is built from all descendants returned by `useDirectory` for the current site.
- Drafts are absent, and no additional client-side visibility filter is applied.
- The active document is highlighted and its ancestor chain is expanded.
- Branches can be expanded and collapsed with pointer and keyboard input.
- Private documents have an accessible lock immediately before the title.
- Search matches titles case-insensitively and renders flat results.
- Clearing search restores the tree's earlier expansion state.
- Selecting a document navigates correctly on web and desktop and closes the mobile drawer.
- Loading, empty, no-results, and error states are present and do not obscure the search control unnecessarily.

## Scope

### Phase 1: Shared behavior and tests — 2 to 3 engineering days

- Extract reusable title filtering from the current All Documents implementation or colocate it with the shared tree
  utility.
- Add tests for active-path expansion, manual expansion preservation, flat title filtering, private-lock presentation,
  and empty states.
- Build the shared File Browser component using existing directory, tree, navigation, icon, input, tooltip, and token
  primitives.

Dependencies:

- Existing `useDirectory` and universal-client authorization behavior.
- Existing `buildDocumentTree` hierarchy utility.
- Existing shared route-link/navigation helpers.

### Phase 2: Desktop and wide-web integration — 2 to 3 engineering days

- Add the shared File Browser beneath the Site Header in the common resource-page layout.
- Integrate a horizontal `react-resizable-panels` layout with the approved width constraints.
- Add collapse/reopen behavior without width persistence.
- Verify document, profile, utility, loading, draft, and error routes do not unintentionally inherit or break the panel.

Dependencies:

- Phase 1 shared component.
- Existing shared resource-page wrapper and panel styling.

### Phase 3: Mobile integration and responsive testing — 1 to 2 engineering days

- Add the File Browser trigger to the Site Header on mobile layouts.
- Render the browser in a full-height, 80%-wide left drawer.
- Implement dismissal, navigation-close, scroll containment, focus management, and reduced-motion behavior.
- Test representative mobile viewport widths and deep hierarchies.

Dependencies:

- Phase 1 shared component.
- Existing mobile sheet/portal primitives.

### Phase 4: Verification and polish — 1 to 2 engineering days

- Run shared unit/component tests and platform-specific route tests.
- Add or update desktop/web integration tests for open, resize, collapse, search, navigation, and mobile drawer flows.
- Run frontend type checking, tests, audit, workspace formatting, and the frontend agent-ci workflow.
- Manually verify desktop app, desktop web, and mobile web against the approved mockup and accessibility behavior.

### Estimate

The first iteration is expected to require approximately **6 to 10 engineering days**, depending on how much the common
resource-page layout must change to keep the Site Header full-width across every supported route.

## Rabbit Holes

- Persisting panel width or open/collapsed state across reloads, devices, accounts, or desktop windows.
- Adding distinct icons for public documents or different document types.
- Refactoring the existing desktop application sidebar, which is separate from this site-level browser.
- Replacing the All Documents table with the new File Browser.
- Virtualizing the hierarchy before measurements show that ordinary memoized rendering is insufficient.
- Supporting body-content search, fuzzy search, ranking, highlighting, or server-side search.
- Adding drag-and-drop document organization or editing document paths from the browser.
- Combining Site Header navigation, document outlines, and the File Browser into one navigation system.
- Broad changes to authorization or private-document capability logic.

## No Gos

- Do not duplicate authorization logic in the frontend or filter the returned directory to public documents only.
- Do not show drafts in this iteration.
- Do not persist the selected panel width or collapsed state.
- Do not make the mobile drawer resizable or push mobile content sideways.
- Do not search document bodies, paths, authors, or other metadata.
- Do not preserve hierarchy in search results; filtered results are deliberately flat.
- Do not add a new resize, drawer, state-machine, or icon dependency when established project primitives already cover
  the behavior.
- Do not make unrelated Site Header, All Documents, desktop sidebar, or document-layout refactors.
- Do not implement document creation, deletion, moving, renaming, reordering, or bulk actions in the File Browser.
