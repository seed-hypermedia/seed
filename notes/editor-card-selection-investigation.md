# Editor Card Selection Investigation (issue #857 follow-on)

## 2026-07-17 UPDATE — root causes found and fixed (see bottom section)

The 2026-07-15 mystery is resolved. "Block tools" = **BlockHoverActionsPositioner** (the copy-link + comment card, right of the block) — a component the earlier session never examined and which the harness never even mounted (DocumentEditor only renders it when onBlockSelect/onBlockCommentClick are passed; the harness passed neither, so "passed in harness, failed live" was structural). See "2026-07-17 session" section at the end for the full fix list.

---

Status as of 2026-07-15. Branch `fix/857-draft-card-matches-published`. **The core desktop bug is NOT yet resolved** — Eric reports block tools still don't appear on first click of a card, despite every fix here passing in the test harness. This doc captures everything learned so the next session can pick up without re-deriving it.

## Problem statement (Eric's spec)

In the desktop editor, for embed cards (draft and published):

1. **Single click on the card body must select it**: blue outline + block tools, in one click. No "start editing" step — focus and go.
2. **Click on an already-selected card body navigates** (opens the doc/draft). Click on the title navigates immediately (title gets underline on hover).
3. **Arrow up/down moves the selection** between blocks: cursor at end of paragraph + ArrowDown onto a card selects the card; two adjacent cards can be arrow-navigated between.
4. **Block tools must be visible whenever a block is selected.**
5. There must be **one notion of selection** — the reported symptoms (block tools reacting to arrows while the outline doesn't; delete working while no outline shows) prove multiple internal selection states. Eric explicitly wants this simplified, slop deleted.

## Current symptom (UNRESOLVED)

On Eric's desktop dev app: first click on a card gives the blue outline (fixed at some point during this work) but **block tools do not appear**. My harness — even running the REAL `DocumentEditor` + REAL `documentMachine` + his exact doc shape — cannot reproduce this: in the harness everything agrees on first click.

**Ambiguity to resolve first next time:** which UI does Eric mean by "block tools / doc tools"?
- The **left-gutter side menu** (drag handle + add button, `SideMenuPositioner`, shown only when a block is fully selected in this fork — NOT on hover), or
- The **right-side floating "..." strip** on cards (`SelectedEmbedActions` in `embed-block.tsx`, bottom-right, shown on hover or selection), or
- The `MediaSelectionMenu` (top-right, non-embed media only).
Earlier he said the strip "appears on the right side" (→ SelectedEmbedActions); later reports just say "block tools". Ask, or instrument both.

## Architecture map (selection)

Single detection source (after this branch's work): **`FullBlockSelectionPlugin`** (`packages/editor/src/blocknote/core/extensions/FullBlockSelection/FullBlockSelectionPlugin.ts`)
- PM plugin state `{blockIds, decorations}` recomputed per selection/doc transaction by `detectFullySelectedBlocks` (handles NodeSelection on blockNode OR content node, MultipleNodeSelection, full-coverage TextSelection, AllSelection).
- Emits `editor.fullBlockSelection.onUpdate(({blockIds}) => ...)` via `FullBlockSelectionView`.

Consumers (all now on this one source):
- **Outline** (`bn-media-selected`): `useIsBlockSelected`/`isBlockSelected` in `block-selection-wrapper.tsx` (the old parallel `computeSelected` implementation is DELETED). Used by `BlockSelectionWrapper` (media-render, draft embeds, button, query) and `EmbedDisplay.isSelected`.
- **Block tools** (`SideMenuPositioner`, `blocknote/react/SideMenu/components/SideMenuPositioner.tsx`): now subscribes directly to `fullBlockSelection.onUpdate`; computes rect from `[data-id]` DOM; Tippy `placement='left'` by default, `appendTo=editor.domElement.parentElement`.
- The old `SideMenuView` (cached mirror + own emitter) is deleted; `SideMenuPlugin.ts` keeps only the drag-monitor PluginView + legacy no-op methods.

Selection creation paths (still TWO for clicks — candidates for future consolidation):
- PM `handleClickOn` in `BlockManipulationExtension.ts` (fires first, creates NodeSelection at the embed node; also open-if-already-selected for url embeds via `shouldOpenSelectedEmbed`).
- React `MediaContainer.selectBlock` (published embeds only; also fires `beginEditIfNeeded` — this is the read-mode→editing entry). Draft embeds have NO MediaContainer — only `handleClickOn` (confirmed on Eric's desktop via `[SEL-DEBUG]` logs: only handleClickOn fired, editable:true).
- Arrow keys: `KeyboardShortcutsSelectPlugin` in the same file (`selectableNodeTypes`).

Editing state machine: `packages/shared/src/models/document-machine.ts` + `DocumentMachineProvider` (`use-document-machine.ts`). `DocumentEditor` (`packages/editor/src/document-editor.tsx`) registers `handlersRef` (setEditable/applyInitialContent/placeCursor) invoked synchronously by machine entry actions on `edit.start`. Desktop doc page = `desktop-resource.tsx` → `DocumentEditor` (NOT `HyperMediaEditorView` — that's comments/other).

## Fixes on this branch (all verified in harness, NOT confirmed on desktop)

Committed earlier (visual, issue #857 proper):
1. `edf230d4` draft embed card shares DocumentCardShell/Thumbnail with published card (newspaper.tsx).
2. `607a3025` shared card border, sans-serif DraftBadge, hover-reveal options on DocumentCard.
3. `cd8e5037` drop the doubled MediaContainer chrome frame on Card/Link embeds.
4. `60f9f138` Card/Link embed "..." menu revealed on hover (was selection-only).

Uncommitted work (this session):
5. **Selection single-sourcing**: `block-selection-wrapper.tsx` rewritten; `computeSelected` deleted; `isBlockSelected` reads plugin blockIds (+ keeps the read-only-unfocused reader guard). Unit test ported (`block-selection-wrapper.test.ts`) incl. new blockNode-level NodeSelection regression case.
6. **SideMenu de-duplication**: `SideMenuPlugin.ts` stripped to drag-monitor; `SideMenuPositioner` derives directly from plugin state. `heading-section-selection.test.ts` ported to the plugin emitter.
7. **Tippy reposition bug (REAL bug, found by DOM-geometry assertion)**: `getReferenceClientRect` memo was `[show, lh]` — moving selection between two same-line-height blocks (two adjacent cards!) never repositioned the side menu. Added `block` dep. This matches Eric's "arrows affect block tools weirdly".
8. **Draft card select-then-open**: `DraftEmbedPlaceholder` used to open the draft on ANY body click (select+navigate simultaneously). Now: mousedown captures was-selected; click opens only if it was already selected.
9. **placeCursor clobber guard** (`document-editor.tsx`): the rAF re-apply of the draft-cursor TextSelection could wipe a card NodeSelection made right after edit-start. Now bails if selection moved.
10. **`selectable-node-types.ts`** extracted (BlockManipulationExtension re-exports) so FullBlockSelectionPlugin doesn't drag the whole schema graph (type-only imports fixed too).

## Test infrastructure built (the main asset)

`frontend/packages/editor/e2e/` web harness (vite :5180 via `npx vite --config e2e/vite.config.ts`):
- **`?real=1` mode** (`test-app/TestEditor.tsx`): mounts the REAL `DocumentEditor` inside the REAL `documentMachine` (`DocumentMachineProvider` default machine — actors only matter for save/publish). Drive lifecycle: harness sends `document.loaded` + `draft.resolved` → `loaded`; tests send `window.TEST_MACHINE.send({type:'edit.start'})` → `editing` runs the real entry actions. `?cursor=N` passes `draftCursorPosition`. Mock universal client answers `Resource` with a schema-valid document so cards render the REAL loaded `DocumentCard`/`EmbedWrapper` DOM. `NavContextProvider` + recording `DraftActionsContext` (`window.TEST_DRAFT_CALLS`) + `window.TEST_OPEN_URL` recorder.
- **`?fixture=draftAndPublished`**: draft embed directly above published embed — Eric's exact doc shape.
- `window.TEST_EDITOR`: `pmSelection()`, `fullBlockIds()`, and `blockToolsBlockId()` which derives from the **rendered DOM** (which block the visible `.side-menu` vertically aligns with) — this is what caught bug #7; never assert block tools from plugin state (circular).
- **Spec `e2e/tests/embed-selection.e2e.ts`** — 9 tests: single-click select (all indicators + no navigation), second-click navigate (both card kinds), arrows between adjacent cards, arrow from paragraph onto card, keyboard-only selection shows the "..." strip (no hover), backspace deletes, loaded-mode click survives placeCursor. Verified the suite FAILS on unfixed code (tests 3/4/9 + arrow-reposition).

Validation state: embed-selection 9/9; full editor e2e 79 passed / 12 skipped; units 315/316 (1 pre-existing failure: `readonly-viewer-gallery.test.tsx`, fails on main too); tsc clean.

## Why the harness may not reproduce the desktop failure — hypotheses ranked

1. **CSS/layout context**: harness page is bare; desktop wraps the editor in `resource-page-common` panels (`ScrollArea`, `overflow-hidden` at resource-page-common.tsx:2155, stacking contexts, titlebar `no-window-drag`). A left-placed Tippy in the gutter could be **clipped/behind/offscreen** on desktop while DOM-present. Next step: replicate desktop wrappers in the harness, or better, drive the real app (below).
2. **Wrong UI element**: "block tools" may mean `SelectedEmbedActions` (right strip), whose visibility depends on `isSelected` + my hover-opacity change (commit 60f9f138) + `!!block.props.url` (never shows for DRAFT cards — no url!) + `view === Card|Link` (draft cards are view=Content → NO strip at all). **If Eric means the right strip on the DRAFT card, it structurally cannot appear — that alone could be the entire remaining bug.**
3. Some desktop-only state (existing draft with saved cursor, autosave transactions, panel focus) that reorders events.

## Ground-truth plan (agreed, interrupted)

Eric offered to quit his dev env (`./dev up`) so I can drive the real app:
1. `./dev run-desktop-mainnet -- --remote-debugging-port=9222` (there's already a `dev:debug` script in apps/desktop; args flow through pnpm → electron-forge → electron).
2. Playwright `chromium.connectOverCDP('http://localhost:9222')`, find the main window page.
3. Open the test doc with the two cards, click card body once, snapshot: `pmSelection`, plugin `blockIds`, `.side-menu` presence + boundingRect + computed visibility/clipping, `SelectedEmbedActions` opacity, which element is at the expected gutter point (`elementFromPoint`).
4. Fix at whatever seam actually breaks; re-verify in BOTH the real app and the harness; only then commit.

Alternative fallback: packaged test app (`NODE_ENV=test npx electron-forge package`, needs `plz-out/bin/backend/seed-daemon-aarch64-apple-darwin` — present) + existing `_electron.launch` fixtures in `apps/desktop/test/utils.ts` (requires onboarding automation; POMs exist).

## Open questions

1. What exactly does Eric call "block tools"? (left drag-handle menu vs right "..." strip — see hypothesis 2.)
2. Should the left side menu ALSO show on hover (classic blocknote), not only on full selection? Current fork = selection-only; Eric's "block tools must be visible when the block is selected" is satisfied by selection-only, but hover-show may be the expectation from the old behavior.
3. Draft cards have no `SelectedEmbedActions` (no url) — should they get an equivalent strip via their own OptionsDropdown when selected? (DraftEmbedPlaceholder has an always-rendered dropdown inside the card instead.)
4. Two click paths remain (`handleClickOn` + `selectBlock`) — consolidate after the desktop bug is found.
5. `readonly-viewer-gallery.test.tsx` failure is pre-existing — fix separately.

## How to run everything

```bash
# Web harness (from frontend/packages/editor)
npx vite --config e2e/vite.config.ts             # :5180
npx playwright test embed-selection.e2e.ts --project=chromium --reporter=list
# Manual: http://localhost:5180/?fixture=draftAndPublished&real=1
#   then in console: TEST_MACHINE.send({type:'edit.start'})

# Full suites
npx playwright test --project=chromium           # all editor e2e
npx vitest --run                                 # units (readonly-viewer-gallery known-fail)

# Real desktop app with CDP (after quitting any running instance)
./dev run-desktop-mainnet -- --remote-debugging-port=9222
# then: playwright chromium.connectOverCDP('http://localhost:9222')
```

---

## 2026-07-17 session — unified block selection (all block types)

Spec (Eric): for EVERY block type, first click selects (blue outline + block tools + side menu), ArrowUp/Down move the selection, tools visible whenever selected, ONE selection source. "Block tools" = **BlockHoverActionsPositioner** (copy-link + comment card, right of the block).

### Root causes found

1. **The hover-actions card had its own selection derivation** (BlockHoverActionsPlugin.selectionBlockState: hasFocus + own ancestor walk) — never read FullBlockSelectionPlugin. Now it does (single block only; collapsed-cursor fallback for text blocks).
2. **Referenceability gate**: the card returned null for any block not in the published version — on a draft card/new block, tools could NEVER appear (the core desktop mystery). Now tools always show; unpublished-block actions open the PublishRequiredDialog (same policy as the formatting-toolbar fragment actions).
3. **Scroll one-way hide**: both positioners hid on the machine `scrolling` event with no re-show path (harness had no scroll wiring → "passed in harness, failed live"). Now they FOLLOW scroll: hover card via capture-phase scroll listener + plugin.refresh(); side menu via live getReferenceClientRect (popper re-reads per scroll).
4. **DOM-observer echoes**: ProseMirror draws a DOM range for NodeSelections; Chrome bounces it off contentEditable=false node views into the nearest editable text, and readDOMChange silently downgraded the block selection (or worse: re-parsed KaTeX and WIPED math content). Fixes: blockNode nodeView ignoreMutation for wrapper attribute mutations (pragmatic-dnd drop-target attrs etc. were forcing re-parses); suppressingSelectionUpdates while a NodeSelection is active (lifted on mousedown/pointerdown over editable text, with a 500ms RECENT_INTERACTION_MS standdown for the restore/focus-recovery machinery); appendTransaction NodeSelection-restore for exact-coverage echoes; focusin recovery when focus gets bounced into an editable island.
5. **Phantom inline content**: video/file/embed/web-embed/button declared `content: 'inline*'` they never rendered → un-representable DOM selections, invisible-caret traps, merge-into-invisible-content data bugs. All five are now LEAF nodes (containsInlineContent: false, selectable: true — like query). Fallout fixed: updateBlock leaf conversion selects the converted block; link-menu embed creation no longer appends schema.text(' '); blockToNode drops legacy content for leaf types.
6. Assorted: CellSelection no longer marks every block selected; query unsuppressed from block tools (hover-suppression is read-mode-only); math selects on first click and opens LaTeX on second (standard outline via BlockSelectionWrapper); button face click selects; web-embed is select-then-open; Backspace boundary list = selectableNodeTypes with the paragraph-emptiness guard restored; arrows use view.endOfTextblock (soft-wrap/code-block safe); edit.start-while-editing no longer clobbers a NodeSelection with a stale cursor; initial mandatory NodeSelection demoted at edit start (all-leaf docs get a trailing paragraph).

### Eric's follow-ups (same day)
- Focusing the draft-card title input selects the card (selectBlockNodeById with focus:false).
- Published card titles (embed Card view AND query-block cards) render as links: hover underline, navigate on FIRST click, even while editing (titleLinkOnly={canEdit}; plumbed through QueryBlockContent → DocumentCardGrid).

### Test infrastructure
- The harness now mounts the REAL BlockHoverActionsPositioner (onBlockSelect/onBlockCommentClick recorders → window.TEST_BLOCK_TOOL_CALLS; `?published=none` for the publish-gate path).
- `allBlocks` fixture (every selectable type + text blocks); TEST_EDITOR gained hoverActionsBlockId() (DOM-geometry) and outlinedBlockIds().
- e2e/tests/block-selection-consistency.e2e.ts: 18 tests — per-type first-click, arrow walk, backspace (delete + boundary text preservation), scroll-follow, publish gate, copy-link recording, draft-title select, title-link navigation.
- Adversarially reviewed via a 25-agent workflow: 13 confirmed findings, all fixed (see commit).

Validation: full editor e2e 97 passed / 12 skipped; units 320/321 (readonly-viewer-gallery pre-existing, fails on main); tsc clean in editor, ui, shared.
