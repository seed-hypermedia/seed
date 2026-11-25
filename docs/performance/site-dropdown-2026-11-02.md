# Site dropdown performance report

Date: 2026-11-02

## Problem

The site selector sometimes opens slowly after the shared sidebar changes. Source inspection found no timer or request
that must finish before the menu opens. The main candidates were mounting every menu row and the page-level work of a
modal dropdown.

## Measurement method

The current `SiteSidebar` component and desktop styles were loaded through the existing Vite server at
`http://localhost:5173/perf-site-menu`. Playwright supplied an isolated test page in Chrome 156.0.8078.76 on macOS. No
additional app server was started.

The fixture used 10, 50, 200, or 500 synthetic sites, with real SVG fallback avatars and immediate in-memory
account/contact responses. A separate case added 10,000 paragraph elements to the surrounding page. Activity polling,
real network requests, and the full desktop app were not part of the fixture.

Each case ran one initial open and 12 repeated opens. The reported values are the upper median of the repeated opens.
Timing starts at the captured `pointerdown` event. A mutation observer detects the mounted menu, then two animation
frames provide a frame checkpoint. This approximates display response; it is not an exact first-paint measurement. Every
sample checks the rendered row count.

The initial open is excluded from the medians because module loading, browser warm-up, and unrelated machine activity
can affect it. The tests use development code in headless Chrome without CPU throttling. These values must not be read
as production latency guarantees or as a reproduction of the user's exact Electron session.

## Investigation results

| Case                           | Original modal menu | Without avatars | Non-modal comparison |
| ------------------------------ | ------------------: | --------------: | -------------------: |
| 10 sites, small page           |               31 ms |               — |                    — |
| 50 sites, small page           |               30 ms |               — |                    — |
| 200 sites, small page          |               42 ms |           37 ms |                37 ms |
| 500 sites, small page          |               97 ms |               — |                    — |
| 50 sites, 10,000 page elements |               69 ms |           64 ms |                28 ms |

The avatar and modality comparisons were applied only to responses in the test browser. They did not change repository
files.

A separate Chrome trace of four open/close cycles confirmed the page-size effect. In repeated opens on the large page,
the modal menu spent approximately 54–55 ms in style recalculation inside the pointer-down handler. The non-modal menu
spent approximately 3–4 ms. Total repeated pointer-down handling was approximately 65–69 ms versus 14 ms. Tracing adds
overhead, so these samples are separate from the untraced measurements above.

## Fix

The site selector now defaults to non-modal mode. This avoids adding a page-wide pointer-event lock, scroll lock, and
accessibility hiding operation when the desktop or wide web sidebar menu opens. Other dropdowns retain their existing
behavior.

The mobile sidebar is already a modal dialog. Browser testing found that making its portaled dropdown non-modal
prevented normal menu scrolling under the enclosing dialog's scroll lock. The layout therefore passes
`siteSelectorModal={isMobile}`. The mobile selector retains modal behavior; desktop and wide web use the faster
non-modal mode.

Sources:

- [Site selector](../../frontend/packages/ui/src/site-sidebar.tsx)
- [Mobile sidebar layout](../../frontend/packages/ui/src/site-file-browser-layout.tsx)
- [Radix dropdown documentation](https://www.radix-ui.com/primitives/docs/components/dropdown-menu)

## Source-fix measurements

The final run against the mobile-aware source change produced these repeated-open values:

| Case                           | Before | After | Interpretation                           |
| ------------------------------ | -----: | ----: | ---------------------------------------- |
| 10 sites, small page           |  31 ms | 29 ms | No material difference                   |
| 50 sites, small page           |  30 ms | 32 ms | No material difference                   |
| 200 sites, small page          |  42 ms | 39 ms | Small improvement                        |
| 500 sites, small page          |  97 ms | 90 ms | Row rendering still costs time           |
| 50 sites, 10,000 page elements |  69 ms | 30 ms | About 56% lower frame-checkpoint latency |

The entrance animation still runs. In this source-fix run it usually completed about 164–248 ms after pointer-down,
depending on the case. Animation completion is a different metric from menu mounting or the frame checkpoint.

## Interaction verification

The final mobile-aware source change passed browser checks at 1440 × 1000 and 390 × 844:

| Check                                             | Desktop fixture                                | Mobile dialog fixture                         |
| ------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Arrow keys open the menu and move focus           | Passed                                         | Passed                                        |
| Escape closes the menu and restores trigger focus | Passed                                         | Passed; drawer stays open                     |
| Outside click dismisses the menu                  | Passed; outside action works on the same click | Passed; modal behavior retained               |
| Moving focus outside dismisses the menu           | Passed                                         | Not applicable: modal focus behavior retained |
| Wheel scrolling moves the menu's scroll position  | Passed                                         | Passed                                        |
| Selection sends the correct site to navigation    | Passed                                         | Passed                                        |
| Touch opens the selector                          | Not separately checked                         | Passed with touch emulation                   |
| Selection closes the mobile drawer                | Not applicable                                 | Passed                                        |

The mobile fixture uses the real sidebar, Dialog, and DialogContent components with the same modal setting and close
callback as the layout. It does not exercise the complete mobile application shell. A physical touch device and screen
reader were not tested.

The existing site-selector and sidebar-layout unit tests passed: 12 tests across two files. The command was:

```sh
direnv exec . pnpm --filter @shm/ui test src/__tests__/site-sidebar.test.tsx src/__tests__/site-file-browser-layout.test.tsx
```

## Remaining work and limits

| Finding                           | Impact                                                                               | Next action                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| All site rows still mount on open | Hundreds of sites still add rendering cost                                           | Measure the affected user's site count before adding virtualization or avatar caching       |
| Mobile keeps modal behavior       | The desktop page-size improvement does not apply directly to the mobile drawer       | Preserve scrolling and focus behavior; profile a real mobile session before further changes |
| Real app activity was excluded    | Network updates, activity polling, and document rendering may add intermittent delay | Capture an Electron performance trace if the original delay remains                         |

## Manual check

1. Open a site with a large document in desktop or wide web mode. Open and close the site selector several times.
2. Use Arrow Down to open the selector, move between sites, and press Escape. Confirm focus returns to the trigger.
3. Open the selector and click a control outside it. Confirm the menu closes and the control works.
4. Open a narrow web sidebar. Open the site selector and scroll its list. Select another site and confirm the drawer
   closes.
5. Compare a short site list with a long one. Keep row-rendering cost separate from the page-size cost addressed by this
   fix.
