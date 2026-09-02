---
name: Testing Seed web app (collection/query UI)
description: How to run end-to-end UI tests against the Seed web app for collection and query block features.
---

# Testing Seed web app (collection/query UI)

## When to use

Use this skill when verifying the Seed web app's collection pages, query blocks, or shared `QueryBlockContent` component
end-to-end.

## Devin Secrets Needed

None for the fixture-account read-only path. Authenticated editing requires an account whose signing keys are available
in the test environment; this machine's Chrome does not support Web Crypto `Ed25519`, so publish/draft-flow UI cannot be
exercised in the browser.

## One-time per session

1. Build the daemon if `plz-out/bin/backend/seed-daemon-*` is missing:
   - `./pleasew build //backend/cmd/seed-daemon` (or equivalent for your platform).
2. Build the web app if `frontend/apps/web/build` is missing or stale:
   - `cd frontend/apps/web && pnpm --filter @shm/web build`
   - The build embeds `VITE_COMMIT_HASH`; confirm it matches the commit under test.
3. Start the integration test environment:
   - `bun tests/integration/seed-collection-ui.ts` seeds a fixture account with `/collection`, `/collection/alpha`,
     `/collection/beta`, and `/query-demo`.
   - It spawns `seed-daemon`, builds the web app, and serves it on `http://localhost:3399`.
   - Data dirs are created under `/tmp/seed-integration-*`.

## Fixture manipulation

- The fixture account DID is `z6MkhMSRCyK9KkAzTmzTKSfuNMaEuYZUJacWmbqiHYkCQgSW`.
- Use `bun tests/integration/update-style.ts` (or a temporary copy) with `createDocumentUpdate` from
  `frontend/apps/cli/src/test/account-helpers.ts` to mutate a document's query block `style` (`Table`/`List`/`Card`)
  without needing browser auth.
- For a collection document, `query.includes` should be `[{space:"", path:"", mode:"Children"}]` to match
  `createDefaultCollectionQueryBlock` semantics.

## Useful UI selectors

- Collection header: `[aria-label="Search documents"]`, buttons `Filter`, `Sort`, `Attributes`.
- View toggle: `button` text `Table`, `List`, `Cards` (note: no `Graph`).
- Query settings: `button[aria-label="Query settings"]`.
- Filter popover: `button` text `Add filter`, `input[aria-label="Filter value"]`.
- Sort popover: `button` `Asc`/`Desc`.
- Attributes popover: switches with column labels.

## Known limitations and workarounds

- **Browser auth / publish flow**: The bundled Chrome on this machine lacks Web Crypto `Ed25519`. Don't try to log in or
  publish from the web app. Test draft/publish flows in the desktop app or another environment.
- **Radix `Select` in popovers**: Programmatic `.click()` on `[aria-selected]` options is unreliable. Prefer
  `SelectField` `value`/`onValue` changes or keyboard navigation.
- **Controlled `Input` in `FilterPopover`**: Setting `input.value` and dispatching `input`/`change` events works for the
  search input but may not trigger `onChangeText` inside the filter popover. If filter UI manipulation is critical, use
  native keyboard typing or set query props server-side and reload.
- **Coordinate scaling**: The desktop is 1600×1069 but the `computer` tool uses a 1024×768 coordinate space. Coordinates
  are mapped automatically; prefer querying elements from the DOM and dispatching trusted events over fragile pixel
  clicks.

## Verification checklist for collection/query PRs

1. Collection header: Table/List/Cards toggle (no Graph), Filter/Sort/Attributes, search, settings menu.
2. Table/List/Card views render the expected documents.
3. Search and sort update results.
4. Filter model (`filterQueryTableItems`) handles date/number comparisons.
5. Query block inside a document renders the same views without the collection header.
6. Query-block Card view whole-card link navigates; collection Card view must pass `navigateCards` to
   `QueryBlockContent` to be clickable.
