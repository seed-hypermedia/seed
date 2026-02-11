# Editor Package Analysis (`@shm/editor`)

## 1. Package Size & Structure

| Metric                  | Value                       |
| ----------------------- | --------------------------- |
| **Total TS/TSX files**  | 177                         |
| **Total lines of code** | 29,409                      |
| **CSS lines**           | 1,637                       |
| **Dependencies**        | 49 production, 13 dev       |
| **E2E test lines**      | 2,471 (across 5 test files) |

### Code distribution by section

| Section                                         | Lines  | %   |
| ----------------------------------------------- | ------ | --- |
| `blocknote/` (forked BlockNote core + React)    | 17,542 | 60% |
| Root `src/` (custom Hypermedia features)        | 9,556  | 32% |
| `tiptap-extension-*` (custom TipTap extensions) | 2,311  | 8%  |

### Top 10 largest files

| File                                                                        | Lines |
| --------------------------------------------------------------------------- | ----- |
| `comment-editor.tsx`                                                        | 1,032 |
| `blocknote/core/BlockNoteEditor.ts`                                         | 1,004 |
| `blocknote/core/extensions/HyperlinkToolbar/HyperlinkToolbarPlugin.ts`      | 960   |
| `blocknote/core/extensions/KeyboardShortcuts/KeyboardShortcutsExtension.ts` | 804   |
| `blocknote/core/extensions/Latex/LatexToBlocks.ts`                          | 776   |
| `blocknote/core/extensions/DraggableBlocks/DraggableBlocksPlugin.ts`        | 743   |
| `tiptap-extension-link/helpers/pasteHandler.ts`                             | 730   |
| `blocknote/core/extensions/SideMenu/SideMenuPlugin.ts`                      | 658   |
| `autocomplete.tsx`                                                          | 603   |
| `media-render.tsx`                                                          | 591   |

---

## 2. Package Usage Across Apps

Only **2 of 9 apps** use `@shm/editor`:

### Desktop App (`@shm/desktop`) — Heavy consumer

- Missing `@shm/editor` in `package.json` (works via pnpm workspace resolution)
- Imports from 10+ entry points: `BlockNoteEditor`, `useBlockNote`,
  `BlockNoteView`, all positioner components, all custom block types,
  `HMFormattingToolbar`, `HypermediaLinkPreview`,
  `createHypermediaDocLinkPlugin`, slash menu, CSS styles, utilities

### Web App (`@shm/web`) — Light consumer

- Properly declared in `package.json`
- Only imports: `CommentEditor` from `@shm/editor/comment-editor`

### Not used by

`@shm/explore`, `@shm/landing`, `@shm/performance`, `@shm/notify`,
`@shm/emails`, `@shm/perf-web`, `@shm/performance-dashboard`

---

## 3. Extensions & Plugins Inventory

### BlockNote Core Extensions (18 total)

| Extension                                               | Status                    |
| ------------------------------------------------------- | ------------------------- |
| Blocks (paragraph, heading, blockContainer, blockGroup) | Active                    |
| BlockManipulation (keyboard nav)                        | Active                    |
| DraggableBlocks (side menu, drag handle)                | Active                    |
| DragMedia (file drag-and-drop)                          | Active                    |
| FormattingToolbar                                       | Active                    |
| HyperlinkToolbar                                        | Active                    |
| KeyboardShortcuts                                       | Active                    |
| LinkMenu                                                | Active                    |
| Markdown (paste/import)                                 | Active                    |
| Placeholder                                             | Active                    |
| SideMenu                                                | Active                    |
| SlashMenu                                               | Active                    |
| TrailingNode                                            | Active                    |
| UniqueID                                                | Active                    |
| **BackgroundColor**                                     | **Dead — commented out**  |
| **TextColor**                                           | **Dead — commented out**  |
| **TextAlignment**                                       | **Dead — not registered** |
| **Latex** (LatexToBlocks)                               | **Dead — never imported** |

### Custom TipTap Extensions (2)

- `tiptap-extension-link/` — Link Mark with autolink, click handler, paste
  handler
- `tiptap-extension-code-block/` — Code block with Lowlight syntax highlighting

### Custom Block Types (12)

`paragraph`, `heading`, `code-block`, `image`, `video`, `file`, `button`,
`math`, `web-embed`, `embed`, `unknown`, `inline-embed`

### ProseMirror Plugins (24)

CursorSelect, KeyboardShortcutsSelect, DraggableBlocks, FormattingToolbar,
HyperlinkToolbar, LinkMenu, SideMenu, SlashMenu, TrailingNode, UniqueID,
Placeholder, Markdown, LocalMediaPaste, HypermediaDocLink, Debug,
codeBlockVSCode, autocompleteToken, addContentBeforeInlineMention, autolink,
clickHandler, pasteHandler, Lowlight, Selection, PreviousBlockType

---

## 4. Code Quality Assessment

### Metrics

| Issue                                       | Count |
| ------------------------------------------- | ----- |
| `@ts-ignore` / `@ts-expect-error`           | ~309  |
| `console.log/warn/error` in production code | ~72   |
| `any` type usage                            | ~255  |
| `TODO/FIXME/HACK` comments                  | ~50   |

### Worst offenders by `any` usage

| File                                                   | `any` count |
| ------------------------------------------------------ | ----------- |
| `blocknote/core/extensions/Blocks/nodes/BlockGroup.ts` | 21          |
| `media-render.tsx`                                     | 20          |
| `blocknote/core/BlockNoteEditor.ts`                    | 18          |
| `blocknote/core/extensions/UniqueID/UniqueID.ts`       | 15          |
| `tiptap-extension-link/helpers/pasteHandler.ts`        | 9           |
| `handle-local-media-paste-plugin.ts`                   | 8           |

### Key quality issues

1. **Type safety is poor** — 309 type suppressions and 255 `any` usages across
   177 files (~3/file). The BlockNote fork inherited weak types and custom code
   added more.
2. **Debug logging left in prod** — 72 console statements, many clearly debug
   (`console.log('~~ MENTIONS RESULTS')`, `console.log('toggleStyle')`).
3. **Code duplication**: `hm-toolbar-link-button.tsx` /
   `mobile-link-toolbar-button.tsx` share ~150 lines of SearchInput; `image.tsx`
   / `video.tsx` share ~100 lines of resize logic; keyboard navigation
   reimplemented in 4+ places.
4. **Large monolithic components**: `comment-editor.tsx` (1,032),
   `autocomplete.tsx` (603), `media-render.tsx` (591), `hm-link-form.tsx` (560).
5. **Deprecated API** — `navigator.platform` in `keyboard-helpers.ts`.
6. **Magic numbers** — file size 62914560, timeout 5000ms, max height 600px
   scattered without constants.

---

## 5. Features Built on Top of BlockNote

| Feature                    | Key Files                                                                                             | Lines  | Description                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| **Hypermedia link system** | `hm-link-form.tsx`, `hm-link-preview.tsx`, `hm-toolbar-link-button.tsx`, `hypermedia-link-plugin.tsx` | ~1,845 | `hm://` protocol links with search, type switching, preview |
| **Formatting toolbar**     | `hm-formatting-toolbar.tsx`                                                                           | 385    | List types, block types, text styling, mobile dialogs       |
| **Image block**            | `image.tsx`, `image-placeholder.ts`                                                                   | ~580   | Resizable images, web import, IPFS                          |
| **Video block**            | `video.tsx`                                                                                           | 391    | YouTube/Vimeo embeds, local/IPFS video, resizing            |
| **Math block**             | `math.tsx`                                                                                            | 347    | KaTeX rendering, LaTeX editor                               |
| **File block**             | `file.tsx`                                                                                            | 100    | File download display                                       |
| **Button block**           | `button.tsx`                                                                                          | 125    | Clickable action buttons                                    |
| **Web embeds**             | `web-embed.tsx`                                                                                       | 237    | Twitter/X, Instagram embed rendering                        |
| **Document embed**         | `embed-block.tsx`                                                                                     | 430    | Embed other Seed documents                                  |
| **Media framework**        | `media-render.tsx`, `media-container.tsx`                                                             | 845    | Upload, drag-drop, file validation, IPFS                    |
| **Mentions/autocomplete**  | `mentions-plugin.tsx`, `autocomplete.tsx`                                                             | 786    | @-mention inline embeds with popup                          |
| **Comment editor**         | `comment-editor.tsx`                                                                                  | 1,032  | Simplified editor variant for comments                      |
| **Local media paste**      | `handle-local-media-paste-plugin.ts`                                                                  | 297    | Clipboard image/file paste handling                         |
| **Mobile UX**              | `mobile-*.tsx` (5 files)                                                                              | ~700   | Mobile-specific dialogs                                     |
| **Nostr integration**      | `nostr.tsx`                                                                                           | 481    | Nostr protocol key/note/event handling                      |

---

## 6. Dead Code & Cleanup Candidates

### Confirmed dead/unused code

| Item                      | Location                                           | Lines | Action                                      |
| ------------------------- | -------------------------------------------------- | ----- | ------------------------------------------- |
| **LatexToBlocks**         | `blocknote/core/extensions/Latex/LatexToBlocks.ts` | 776   | Never imported. **Deleted.**                |
| **BackgroundColor ext**   | `blocknote/core/extensions/BackgroundColor/`       | ~60   | Commented out. **Deleted.**                 |
| **TextColor ext**         | `blocknote/core/extensions/TextColor/`             | ~60   | Commented out. **Deleted.**                 |
| **TextAlignment ext**     | `blocknote/core/extensions/TextAlignment/`         | ~40   | Not registered. **Deleted.**                |
| **HypermediaLinkToolbar** | `hyperlink-toolbar.tsx`                            | ~80   | Exported but never used. **Deleted.**       |
| **testUtil.ts**           | `blocknote/core/api/nodeConversions/testUtil.ts`   | ~30   | Never imported. **Deleted.**                |
| **Nostr block**           | `nostr.tsx`                                        | 481   | Commented out in both schemas. **Deleted.** |

**Total dead code removed: ~1,527 lines**

---

## 7. Execution Plan Priorities

### High priority (quality & maintenance) — DONE

1. ~~Remove dead code (Latex, unused extensions, hyperlink-toolbar, testUtil,
   nostr)~~
2. ~~Remove console statements from production code~~
3. ~~Fix missing `@shm/editor` dependency in desktop's `package.json`~~

### Medium priority (architecture)

4. Extract shared components: SearchInput, resize hook, keyboard navigation
   handler
5. Break up large files: `comment-editor.tsx`, `autocomplete.tsx`,
   `media-render.tsx`
6. Address type safety: focus on top 6 files with highest `any` counts

### Low priority (long-term)

7. Evaluate BlockNote fork freshness — fork is from BlockNote v0.x (TipTap
   2.0.3). Consider upstream migration.
8. Consolidate mobile components — 5 mobile-specific files could share more
   logic
9. Replace deprecated `navigator.platform`
10. Add unit tests for block manipulation, link resolution, autocomplete (only
    E2E exists)
