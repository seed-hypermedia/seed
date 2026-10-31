# Seed Atlas

A separate, read-only browser app for exploring public Seed sites on a spatial canvas.

Add a site URL to load its documents. Drag cards by their headers, select a document to see its conversations, or use
Focus to show the selected page and its direct connections in a temporary compact layout. Focus does not change saved
card positions. Read expands a document on the canvas. Whole site returns to an overview. External documents appear as
compact cards; Explore this site adds their site's documents. Conversations can be pinned as movable groups. Open web
and Open Seed open the source document.

Enter any public Seed site URL. The app always starts at the empty welcome screen, even when this browser has a saved
layout. Sites load only after you submit a URL or click **See a demo site**. The demo button loads
`https://seedteamtalks.hyper.media`. Saved positions are reused when you explicitly load a site again. One large test
site is <https://seedteamtalks.hyper.media>.

## Cloudflare Pages

Live experiment: <https://seed-atlas-7nm.pages.dev>.

Project: `seed-atlas`, production branch: `main`. This is a Direct Upload deployment of the static Vite build. It is not
connected to Git auto-deployments.

To publish an update from the repository root with an authorized Cloudflare login:

```sh
direnv exec . pnpm --filter @shm/canvas build
direnv exec . pnpm dlx wrangler@4.151.1 pages deploy frontend/apps/canvas/dist --project-name seed-atlas --branch main --commit-dirty=true
```

Only the built `dist` directory is uploaded. Reference:
[Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Development

Use the repository toolchain:

```sh
direnv exec . pnpm --filter @shm/canvas dev
direnv exec . pnpm --filter @shm/canvas typecheck
direnv exec . pnpm --filter @shm/canvas test
direnv exec . pnpm --filter @shm/canvas build
```

Agents must start the app through a configured Jean Run environment. This worktree did not have a Run command configured
when the app was added. Use the URL Jean reports after starting it.

The optional read-only integration test calls the public test site:

```sh
direnv exec . env SEED_CANVAS_LIVE=1 pnpm --filter @shm/canvas test src/live.test.ts
```

## Data and updates

- Public data is fetched directly with the workspace Seed client. No sign-in, local daemon, or app backend is required.
- The app reads every page of `QueryDocuments`, then loads document bodies and citations with bounded concurrency.
- Each loaded site’s event feed is checked every three seconds while the tab is visible. `ListEvents` uses observed-time
  ordering so late network arrivals are detected. Checkpoints are advanced only after successful event processing.
  Listing scans run independently so large sites do not block event checks.
- Full listings run every 30 seconds and also detect removals that the resolved event feed may omit. Removed cards
  retain their positions and show an unavailable state. Their connections are removed.
- Site checks do not overlap. A slow response can extend the update delay beyond three seconds. Updates from separate
  sites and open conversations run independently.
- View suffixes such as `:activity` resolve to the same document identity. `:profile` is the exception: it creates one
  account card per account, separate from its home page. Account cards load the Account API and show a name, avatar when
  available, description, and profile/site actions. Saved layouts migrate these cards to one page.
- Redirects and tombstones use compact status cards. Redirect cards include a link to the target.
- Only document content and graph relationships change during refresh. Positions are saved separately. New cards use
  free space; there is no automatic force layout. New layouts put home first, then labeled path groups to the right.
  Top-level leaf pages share a Pages group. **Arrange by path** applies this layout to existing cards.
- Layout, zoom, expanded cards, loaded sites, and pinned thread identities are saved to this browser's local storage.
  Document bodies are fetched again on reload.
- Web links are resolved with Seed identity headers when the remote site permits cross-origin reads. Ordinary web links
  remain links in the document body.

## Large sites

- Off-screen nodes are not rendered. Below 35% zoom, ordinary cards show a short title/path view with no images or body
  rendering. Only the selected page’s connection lines remain visible at that scale.
- Unchanged document nodes keep their object identity. Card actions stay stable, and document link extraction and
  preview text are cached.
- New-card placement uses a cell index instead of scanning every occupied position per card.
- Focus keeps the selected page anchored and fits again when its direct neighbors arrive. It temporarily disables
  dragging; leave Focus to change saved positions.
- Full listing scans run separately from three-second event checks. Document and citation reads remain bounded to four
  concurrent jobs.

A local synthetic test of 2,000 document positions measured the previous collision scan at 250 ms and the indexed layout
at 11 ms. This measures placement only, not browser frame rate. Browser rendering still needs profiling in a configured
Jean Run environment.

The approach follows [tldraw’s culling and level-of-detail guidance](https://tldraw.dev/sdk-features/performance),
[React Flow’s memoization guidance](https://reactflow.dev/learn/advanced-use/performance), and
[Figma’s work on deferred loading and cached derived data](https://www.figma.com/blog/speeding-up-file-load-times-one-page-at-a-time/).

## Contrast and account cards

Cards use darker text and borders. At overview scale, filled silhouettes keep pages and accounts visible. Accounts have
a person icon and an ACCOUNT label; linked pages use dashed borders, accounts use rounded double borders, and
conversation connections use dashed lines. Selection has a thick outline. A card-type legend is visible on the canvas.

Calculated color-pair ratios: main text 15.27:1, secondary text 6.83:1, card borders 4.40:1, overview text at least
9.10:1, and connection strokes at least 6.71:1. These are static color calculations, not a full accessibility audit or a
browser rendering check. Targets follow
[WCAG contrast guidance](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum).

## Current limits

- Incoming citations are limited by the source server's API. The canvas cannot claim a complete view of the entire Seed
  network.
- Unavailable sites and failed requests show retry states. Content that a gateway has not discovered can remain
  unavailable until that server receives it.
- Standard text, annotations, headings, images, tables, code, and native video are rendered. Embeds and attachments open
  their source. Dynamic collections show an open-source notice, and math is shown as source text.
- No content editing, publishing, shared layouts, or account access is included.

## Manual checks

1. Load the test site. Confirm document cards appear and the loading count decreases.
2. Move a card, expand it, and reload. Confirm its position and expanded state return.
3. Select a connected document. Open Connections, navigate to a neighbor, then use Focus and Whole site.
4. Open a conversation and pin it. Move its group, reload, and confirm the group returns. Repeat with a linked external
   document.
5. Add an external site. Confirm existing cards keep their positions and the linked card becomes part of the loaded
   site.
6. Make a change through an authorized Seed client, or observe a real update. Confirm Atlas updates its content without
   moving cards. Check comment additions, edits, and removals as well as document changes.
7. Follow both a page link and its `:activity` or other view link. Confirm there is one document card.
8. Focus a page before its links finish loading, then switch focus to a neighbor. Confirm the selected page stays
   visible. Exit Focus and confirm saved site positions return.
9. Use Arrange by path from Focus. Confirm the camera shows the arranged site, with home first and path labels beside
   it.
10. Read a redirect and a tombstone. Confirm they show small status cards without a loading spinner or body. Open a
    redirect’s target.
11. Zoom out on the large test site. Confirm cards simplify and unrelated connection lines disappear. Zoom back in and
    select a page.
12. Add a different public Seed URL and confirm its title, home page, and groups are separate.
13. Disconnect and reconnect. Confirm the update status changes and the feed catches up without duplicate cards.

## Design references

The interaction research used [Kinopio](https://github.com/kinopio-club/kinopio-client). No Kinopio code was copied; its
source uses the PolyForm Noncommercial license. The canvas uses
[React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), including header-only drag handles,
and the repository's React/Vite toolchain.

Account check: follow both a home-page link and its `:profile` link. Confirm they create separate page and account
cards. Focus the account, open its profile, and reload to check its position. Check card types and selection in
grayscale at normal and overview zoom.
