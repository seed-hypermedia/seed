# Unsticky DocumentTools

## Problem

The document tools row (Content / People / Comments / Citations / Attributes) is pinned to the top of the scroll
container on every document page, on all three surfaces (Electron desktop, web desktop, web mobile). It floats over the
document while reading, and a set of unrelated behaviors have accumulated around that single decision:

- It occupies vertical space permanently — most costly on mobile web, where it becomes the de-facto top bar once the
  site header scrolls off, and where it is also the only home for the page actions (`...` options menu, Save indicator,
  Publish button).
- Two scroll offsets exist purely to clear it: a hardcoded `STICKY_HEADER_OFFSET = 88` applied to every programmatic
  scroll (`frontend/packages/ui/src/use-block-scroll.ts`), and `sticky top-24` on the outline sidebar
  (`frontend/packages/ui/src/resource-page-common.tsx:3296`). The 88px constant's comment points at a
  `.blocknode-content` `scroll-margin-top` rule that no longer exists in the repo, so it is an unanchored magic number.
- It needs an opaque background, `z-10`, and an `IntersectionObserver` watching a zero-height sentinel purely to toggle
  a `shadow-md` elevation cue (`resource-page-common.tsx:1888-1911`, `:2409-2469`).
- A UX review across all three surfaces (see `DOCUMENT_TOOLS_STICKY_OVERVIEW.md`) found the elevation cue is **broken on
  mobile web**: the row renders with `shadow-md` while unpinned at `scrollY=0` and never clears, because `isToolsSticky`
  is stuck `true` on that code path. It also found the block hover-action card drawing _over_ the pinned row, since the
  row is only `z-10`.

The row is navigation for a minority of sessions (most readers stay on Content), but it behaves like permanent app
chrome. Reading is the primary use of a document page, and the primary surface for reading is mobile web, where the cost
is highest.

## Solution

Stop pinning the row. It stays exactly where it is in the page — after the cover and document header, before the body —
and scrolls away with them. Everything that must remain reachable moves out of it.

User stories:

- As a reader on mobile web, the document fills the screen as I scroll; no bar follows me down the page.
- As a reader who has scrolled a long document on mobile web, I can return to the top (and therefore to the tabs) with
  one tap.
- As an author editing on any platform, the Publish button, save state, and options menu stay in the same fixed place
  regardless of scroll position.
- As anyone following a link to a specific block, the block lands at the top of my viewport, not 88px under it.

Included:

- **Un-stick the row.** Drop `sticky top-0 z-10`, the opaque background, the `shadow-md`/`shadow-none` toggle and its
  `transition-shadow`. Delete `isToolsSticky`, `toolsSentinelRef`, the `IntersectionObserver` effect, and the sentinel
  `div`. Replace the elevation cue with a hairline `border-b border-border` so the row still reads as navigation
  separating document identity from document body. This also removes the stuck-mobile-shadow bug and the hover-card
  `z-10` conflict by construction.
- **One page-actions overlay for all platforms.** Delete the mobile-only `documentToolsRightAction` branch
  (`resource-page-common.tsx:2259`) so `DocumentTools` no longer receives a `rightAction` on mobile, and change the
  existing `documentContentActionOverlay` from `absolute` to `fixed` so it survives document scroll on mobile web
  (`absolute` only works today because the desktop container does not scroll). Top-right on every platform, matching
  Notion and Google Docs mobile — deliberately not a bottom bar or bottom FAB, because Publish must be reachable while
  editing, which is exactly when the bottom of a mobile screen is the on-screen keyboard.
- **Retune the two offsets that existed to clear the bar.** `STICKY_HEADER_OFFSET` 88 → a small breathing-room value
  (~16px), and the outline wrapper `sticky top-24` → `sticky top-4`. Verify against both scroll paths (`#blockRef` deep
  links and outline clicks).
- **Back-to-top on mobile web only.** A small dark circular icon button, horizontally centered near the bottom of the
  viewport, fading in after roughly 1.5 viewport heights of scroll and respecting `prefers-reduced-motion`. Mobile only:
  desktop and Electron keep the outline sidebar for in-document navigation. It must resolve its scroll target the same
  way `use-block-scroll.ts` already does rather than assuming `window`.
- **Container-query label collapse.** Replace the hidden duplicate tab row + `ResizeObserver` in `document-tools.tsx`
  (`:77-104`, `:286-307`) with a Tailwind v4 `@container` on the row and `@min-*` variants on the labels, plus
  `min-w-0`/`truncate` so the worst case degrades to truncation rather than overflow or horizontal scroll. Container
  queries are used because the constraint is _container_ width, not viewport width — the content column shrinks when a
  panel opens or the outline appears at an unchanged viewport width, which `md:` classes cannot express. If testing
  turns up a real overflow case the container query cannot handle, the measurement comes back.

Not changed:

- The inspector keeps its own sticky toolbar (`frontend/packages/ui/src/inspector-shell.tsx:20`). It is a developer
  surface with wide tables and nine tabs, shares no code with the document row, and is not part of the reading
  experience.
- The `showActivity` metadata gate, the tab set, the routes each tab links to, panels, and `MobilePanelSheet` behavior.

## Scope

**Phase 1 — Unsticky (one session).** Everything in "Included" above except the container-query change, i.e. the sticky
removal, the fixed actions overlay, the hairline border, the two offsets, and the mobile back-to-top button. All of it
lives in `resource-page-common.tsx`, `use-block-scroll.ts`, and one new small component. No dependencies. No tests
currently assert stickiness (nothing in `frontend/**/*.test.*` or the editor E2E suite references it), so this phase
adds the first coverage: block-scroll offset and the presence/absence of the actions overlay per platform.

**Phase 2 — Row cost (one session, depends on Phase 1).** The `@container` label collapse, with before/after render
counts for the row, and a check of the intermediate widths that motivated the original measurement (panel open, outline
visible, Attributes tab present, 3-digit counts).

**Phase 3 — Layout observers (one session, independent).** Kept separate on purpose: `useDocumentLayout`
(`frontend/packages/ui/src/layout.tsx:109-129`) runs a `MutationObserver` on `document.body` with `subtree: true` for
the lifetime of every document page, only to notice when its own ref mounts — it fires on every editor keystroke that
mutates the DOM. Replaceable with a ref callback. This is likely the largest single performance win of the three phases
and deserves its own profiling rather than being smuggled into a UX change.

Verification for each phase runs on all three surfaces (Electron, web desktop, web mobile) using the local-stack
procedure captured in `.agents/skills/testing-local-web-desktop-stack/SKILL.md`.

## Revision — persistent document top bar

Reviewing Phase 1 on device showed the fixed overlay and the back-to-top button as two workarounds for the same missing
thing: a place in the layout that does not scroll. So the page now has one, and both workarounds are gone.

`DocumentTopBar` (`frontend/packages/ui/src/document-top-bar.tsx`) is a 48px row and a **sibling of the content scroll
area**, not a `sticky` child of it: on desktop and Electron it simply sits above the `ScrollArea` in a flex column, so
persistence is a layout fact rather than a paint trick. Mobile web scrolls the document itself, so there the same bar is
`sticky top-0` and pins under the site header as it scrolls away.

- Left: the file-explorer reveal button, then the breadcrumbs. Right: Publish/save and the `...` menu — the exact
  `documentContentAction` composition the overlay used, unchanged.
- Breadcrumbs move out of `DocumentHeader`/`EditableDocumentHeader` (the `breadcrumbs` prop is gone) and out of the
  home-document-only trail that rendered view labels in the page body. `Breadcrumbs` now renders a single crumb instead
  of bailing out at `length <= 1`, so a home document reads as just the Home icon, `aria-current`, not a link.
- The reveal button's state belongs to `SiteFileBrowserLayout`, so that component now publishes `collapsed`/`setCollapsed`
  through context. The bar *claims* the button while it renders one, and the layout keeps its own floating fallback for
  routes that have no bar (feed, inspector) rather than duplicating the state.
- `use-block-scroll.ts` scrolls the window explicitly on the no-scroll-container path, subtracting the bar's height when
  it is actually pinned (measured from the `data-document-top-bar` element, not hardcoded), which also fixes the mobile
  deep-link landing under the bar.
- Electron gets the same bar with the same contents. Its titlebar shows the sidebar toggle and the omnibar, never the
  breadcrumbs, so this is the only place that says where you are.

## Rabbit Holes

- **Rebuilding the information architecture.** Rendering discussions inline at the end of the Content view, or echoing
  the tab counts at the end of the document, are both defensible and both change what the Comments _view_ is for. Out of
  this project; the mobile back-to-top button is the agreed answer to "I finished reading".
- **Moving tabs into the site header.** Would make them persistent without stickiness, but rewrites `SiteHeader` layout
  on three surfaces and collides with site navigation items.
- **Auto-hiding site header.** `useAutoHideSiteHeader` (`site-header.tsx:595`) is fully implemented and imported
  nowhere. Deleting dead code is fine; reviving it as a substitute for the sticky row is a different project.
- **Chasing the mobile stuck-shadow root cause.** The observer bug disappears with the code that hosts it. The hydration
  errors seen alongside it ("Invalid hook call", "server HTML was replaced with client content") on the Vite dev server
  may be a real SSR bug worth its own investigation — but not as part of this.
- **Unifying the two sticky implementations.** The inspector's bar looks like a duplicate abstraction begging to be
  shared; it has different requirements and is explicitly out of scope.
- **Perfecting the back-to-top button.** Scroll-spy thresholds, hide-on-scroll-up, haptics, and a matching desktop
  variant. One threshold, one fade, mobile only.

## No Gos

- Do not make the row sticky on some platforms and not others, and do not add a preference for it. One behavior
  everywhere is the point.
- Do not remove the tab row, change which tabs exist, or change where they navigate.
- Do not put mobile page actions at the bottom of the screen (keyboard collision while editing).
- Do not touch the inspector's sticky toolbar.
- Do not introduce a new scroll-position library or a global scroll store; reuse the scroll-container resolution already
  in `use-block-scroll.ts`.
- Do not leave the 88px offset in place "because it still looks fine" — an unanchored magic number tuned to chrome that
  no longer exists is exactly the debt this project is paying off.
- Do not fold the Phase 3 observer change into the Phase 1 PR.
