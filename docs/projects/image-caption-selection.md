# Image Caption Selection

## Problem

You cannot select text inside an image caption in the document editor. Selecting caption text in edit mode produces a
browser highlight but no ProseMirror selection, so nothing that depends on selection works there: no formatting toolbar,
no bold/italic/link on caption text, and no fragment actions (Copy Link, Comment) targeting a caption range. Dragging
with the mouse inside a caption collapses to a caret instead of selecting.

The same caption is fully selectable for a read-only reader, which makes the gap visible in practice: a reader can
comment on a phrase in a caption, but the author who wrote it cannot select that phrase at all — and an author viewing
their own published document cannot either, because the drag flips the document into edit mode instead.

Verified in the `@shm/editor` E2E harness (`?real=1&fixture=allBlocks`, real `DocumentEditor`), with a plain paragraph
as the control in every case:

| Mode                                 | Caption fragment selection             |
| ------------------------------------ | -------------------------------------- |
| Edit mode                            | Broken — no PM selection, no toolbar   |
| Read-only, reader (`canEdit=false`)  | Works — emits `blk-image[0:9]`         |
| Read-only, user with edit permission | Broken — drag enters edit mode instead |

### Root cause

Two independent causes. Both must be fixed; neither alone is sufficient.

**1. The caption is a separate editing host (primary).** The runtime DOM chain from `.image-caption` up to `view.dom`:

| #   | Element                                               | `contenteditable` | `draggable` |
| --- | ----------------------------------------------------- | ----------------- | ----------- |
| 0   | `.image-caption`                                      | **true**          | –           |
| 1   | MediaContainer outer wrapper (`media-container.tsx`)  | –                 | **true**    |
| 2   | `div.flex.w-full.flex-col` (`media-render.tsx`)       | –                 | –           |
| 3   | **`BlockSelectionWrapper`** (`media-render.tsx`)      | **false**         | –           |
| 4–7 | blockContent / node-image / blockNode / blockChildren | –                 | –           |
| 8   | `div.ProseMirror` = `view.dom`                        | **true**          | –           |

`BlockSelectionWrapper` renders `contentEditable={false}` around the whole media subtree, caption included. The
caption's own `contentEditable={true}` therefore creates a nested editing host: `document.activeElement` becomes the
caption div, `view.hasFocus()` is `false`, and prosemirror-view's `hasFocusAndSelection()` discards every selection made
inside it. This is the case ProseMirror's author warns about directly — "A single ProseMirror editor can only manage a
single contenteditable range, so there can't be uneditable elements with editable islands in them"
([discuss.prosemirror.net](https://discuss.prosemirror.net/t/nodeview-rendering-child-nodes-without-contentdom/5014)).

The `FormattingToolbarPlugin.shouldShow` → `view.hasFocus()` gate is a **symptom of this**, not a separate blocker. It
passes on its own once the editing host is fixed.

**2. A `draggable` ancestor swallows mouse drags.** The MediaContainer outer wrapper is `draggable=true`, so a
mousedown-and-move inside the caption starts a native HTML5 drag rather than a text selection. Fixing this alone makes
the DOM selection appear but PM still sees nothing; fixing cause 1 alone leaves keyboard selection working and mouse
drag broken.

### How other editors model this

Every editor that supports caption formatting **and** unified selection makes the caption ordinary document content in
the same contenteditable:

- **Atlassian ADF** — `mediaSingle` contains a `media` node and a sibling `caption` node with inline content and marks.
- **Tiptap figure/figcaption** — `content: 'image figcaption'`, rendered via `renderHTML` with no React node view and no
  `contenteditable=false` wrapper.
- **Slate** — `figure` is a normal element with a caption child; only the image itself is void.

The alternative is a nested editor (**Lexical playground**: `ImageNode` is a `DecoratorNode` owning a full nested
`LexicalEditor` for the caption). That buys rich formatting but permanently gives up document-level selection across or
into the caption. Seed today has the nested-editor drawbacks without being a nested editor.

Seed's schema is already in the right family: the image block is `containsInlineContent: true` and the caption is the
image node's inline content, serialized to the block's `text` with annotations. **No schema or data-model change is
needed.** The bug is purely in how the node view's DOM is wrapped.

## Consuming-side verification

Gap #1 — whether a caption-targeted range resolves and renders — is verified closed for the editor/viewer layer. The
runtime harness used the real editor and verified:

- `rangeFocus` for `blk-image[0:5]` produces one `.bn-range-highlight-focus` inside `.image-caption` over the expected
  characters; a paragraph control behaves the same way.
- Codepoint offsets survive an emoji: for `ab😀cd`, `3:5` selects `cd` and `0:3` selects `ab😀`; no surrogate pair is
  split.
- Citation fragment highlighting renders over the caption and is clickable.
- The read-only quote viewer, using the same props passed by `QuotedDocBlock`, highlights the caption, and the
  quoted-text preview is non-empty.
- Unknown block IDs, `3:3`, `7:2`, and `50:80` produce zero decorations without throwing, and the editor recovers for a
  subsequent valid range.
- `document.getElementById('blk-image')` is a valid scroll target.

The consuming implementation is generic. `BlockHighlightPlugin` and `CitationFragmentHighlightPlugin` match any
`blockNode` by ID and walk its inline content; neither assumes a paragraph selector or a particular block type.
`getBlockText()` returns `block.text` for `Image`, so caption text is also available to quoted-text previews. **No
consumer-side code change is needed.**

The following app-level paths remain unverified:

- Real URL navigation with a `#blk-image[0:5]` browser hash.
- Daemon-backed comment creation on a caption range.
- The real `QuotedDocBlock` path in desktop and web.
- The quoted-text preview assembled in `frontend/packages/ui/src/resource-page-common.tsx`.
- Citation `targetBlockRevision` filtering against a published document with revisions.

## Solution

Keep the schema and the data model exactly as they are. Stop the media node view from making the caption's DOM
non-editable, and move the drag affordance off the caption's ancestors.

A throwaway version of this patch was applied in the harness and confirmed to work end to end:

- Give `BlockSelectionWrapper` an opt-out so it does not force `contentEditable={false}` over a block that has inline
  content, and use it for image blocks from `media-render.tsx`. The media surface div keeps its own
  `contentEditable={false}`.
- Move `draggable` and `onDragStart`/`onDragEnd` from the MediaContainer outer wrapper onto the media-surface div (the
  one already marked `contentEditable={false}`), so the caption is no longer inside a draggable region.
- Keep `data-media-container-ignore-select` on the caption and the existing `lastMousedownInCaption` guard in
  `BlockManipulationExtension` — they are what let caption clicks coexist with whole-node media selection.

Measured with the throwaway patch in place:

- Caption keyboard selection produces a non-empty PM `TextSelection` inside the image node, with `view.hasFocus()` true
  and the formatting toolbar showing Comment and Copy Link.
- Copy Link on a caption selection emits `blockId=blk-image`, `start:0`, `end:11`.
- Real mouse drag inside the caption selects and opens the toolbar.
- Paragraph control still emits `p-top` `0:15`.

User stories:

- As an author, I can select part of an image caption and make it bold, italic, or a link.
- As an author, I can select part of my own caption and copy a fragment link or start a comment on it, the same way I
  can in a paragraph.
- As a reader, caption fragment selection keeps working exactly as it does today.
- As an author, I can still click an image to select the whole block, drag it to reorder, and resize it.

### Open decisions

These change the shape of the patch and should be settled before implementation starts:

1. Should `BlockSelectionWrapper` stop wrapping image blocks entirely, or gain an inline-content-aware mode? The
   inline-content-aware mode is narrower and is what was validated; skipping the wrapper outright is simpler but drops
   whatever else the wrapper provides for images.
2. Should block drag for images live only on the media surface? That is the validated shape, and it shrinks the drag
   affordance area — the caption strip stops being a drag handle. The side-menu drag handle is unaffected.

### Acceptance criteria

Everything below is a runnable check, not a judgement call. The pre-fix state of the Phase 2 tests must be **failing**,
so they are written first and demonstrate the regression before the fix lands.

## Scope

Five phases. Phases 1–3 are the shippable core; 4 and 5 gate the production push.

**Phase 1 — Failing tests first (0.5 day).** No dependencies.

- Unit (`media-container.test.tsx`): assert the caption's DOM is not inside any `contenteditable=false` ancestor within
  the node view, and that no ancestor between the caption and the node-view root is `draggable`. These are the two root
  causes expressed as assertions, so they cannot silently regress.
- E2E (`e2e/tests/image-caption.e2e.ts`): select a caption substring by keyboard and by mouse drag; assert a non-empty
  PM `TextSelection` inside the image node; assert the toolbar appears; assert Copy Link emits the image block ID and
  the expected offsets. Use `window.TEST_BLOCK_TOOL_CALLS` to read the emitted range.
- Fixture blocks need a `revision` for fragment actions to appear at all — without it the referenceable-revision gate
  hides them and a caption failure is meaningless. Add it to the harness fixture.

**Phase 2 — The fix (0.5 day).** Depends on Phase 1.

- The three bullets in Solution. Phase 1 tests go green.

**Phase 3 — Media regression sweep (1 day).** Depends on Phase 2.

- E2E over `fixture=allBlocks`: click-to-select for image, video, file, embed, web-embed; arrow traversal across media
  nodes; Backspace/Delete removal; image and video resize handles; side-menu drag-handle reorder; media selection menu
  replace/delete; URL input paste (must not reach editor-level paste handlers); file drop upload.
- Caption behavior that already works and must keep working: typing, Enter navigation, Shift+Enter line break, clicking
  the caption not producing a `NodeSelection`, clicking the media surface producing one.

  Known **pre-existing** failures — confirmed identical on an unpatched tree, do not treat as regressions and do not fix
  here: media-surface drag does not reorder the block, Enter inside a caption does not exit it, embed-card click selects
  nothing. Video click selection is untestable in the current fixture (no source).

**Phase 4 — Clipboard and SSR (1 day).** Depends on Phase 2, parallel with Phase 3.

- Internal copy/paste of an image block with a caption, within one document and between two documents (two pages in one
  browser context sharing the real clipboard; the fixtures already grant clipboard permissions and expose
  `setClipboardHTML`/`paste`). Assert the caption survives and the destination block ID is regenerated.
- External paste: `<img>` alone, and `<figure><img><figcaption>`. Today `handle-local-media-paste-plugin` intercepts the
  first image source and uploads it, and no rule maps `figcaption` to the caption — so the caption is dropped. Write the
  test to **document current behavior**; improving it is out of scope (see No Gos).
- Copy and cut of caption text itself.
- SSR (`ssr-render.test.tsx`): the relocation logic keys off `[data-node-view-content]` and does not read
  `contenteditable`, so it should be unaffected — but assert it explicitly: caption text present, caption inside the
  node-view content slot, `contenteditable` on the intended element only, and server structure matching the live harness
  DOM.

**Phase 5 — Mobile (1 day).** Depends on Phase 2.

- CDP mobile emulation at 390×844, dsf 2, touch on. Long-press caption text; selection handles; range action bubble
  appears and is tappable; soft keyboard opening and the resulting visual-viewport resize; caption Enter.
- Real mouse dragging is unreliable under CDP mobile emulation — set the native DOM selection and the PM selection, then
  dispatch `mouseup`, as documented in the testing-editor-harness skill.

**Total: ~4 days**, of which ~3 are tests. Phases 3–5 can run in parallel once Phase 2 lands.

### Gate for pushing to production

All of Phase 1, 3, 4, and 5 green, plus one manual pass in the desktop app on a real published document: select caption
text, apply a mark, copy a fragment link, paste it back, and confirm it resolves to the caption range. The harness does
not cover the desktop shell, real publishing, or the real clipboard.

### Harness testing guidance

When testing highlight consumers in the harness, drive the plugin through the React props that the real editor uses
(`focusBlockId`, `focusBlockRange`, and `citationFragmentHighlights`). Console-dispatched plugin metas such as
`view.dispatch(tr.setMeta(blockHighlightPluginKey, ...))` are swallowed in this harness and are not a reliable
substitute for the component path.

The harness resets window scroll to `0` about a second after a scroll. Measure scroll targets synchronously after the
navigation/scroll action; delayed assertions can observe the harness reset rather than the behavior under test.

## Open gaps

- [ ] Edit-mode caption selection and its two DOM root causes — see
      [#925](https://github.com/seed-hypermedia/seed/issues/925)
      (`docs/projects/image-caption-selection-issues/01-image-caption-selection-edit-mode.md`).
- [ ] Author viewing their own published document enters edit mode instead of selecting a caption range — see
      [#926](https://github.com/seed-hypermedia/seed/issues/926)
      (`docs/projects/image-caption-selection-issues/02-image-caption-selection-own-published-doc.md`).
- [ ] Collaboration/Yjs caption editing and range anchoring — see
      [#927](https://github.com/seed-hypermedia/seed/issues/927)
      (`docs/projects/image-caption-selection-issues/03-image-caption-collaboration.md`).
- [ ] Image caption mark serialization round-trip — see [#928](https://github.com/seed-hypermedia/seed/issues/928)
      (`docs/projects/image-caption-selection-issues/04-image-caption-marks-round-trip.md`).
- [ ] Product decision and tests for cross-block selections around captions — see
      [#929](https://github.com/seed-hypermedia/seed/issues/929)
      (`docs/projects/image-caption-selection-issues/05-image-caption-cross-block-selection.md`).
- [ ] Undo/redo, IME/composition, spellcheck, and screen-reader behavior — see
      [#930](https://github.com/seed-hypermedia/seed/issues/930)
      (`docs/projects/image-caption-selection-issues/06-image-caption-editing-edge-cases.md`).
- [ ] Project owner, rollout plan, and estimate calibration — see
      [#931](https://github.com/seed-hypermedia/seed/issues/931)
      (`docs/projects/image-caption-selection-issues/07-image-caption-project-plan.md`).

## Rabbit Holes

- **Rewriting the schema to `figure`/`figcaption` or an ADF-style `caption` child node.** Tempting because it is what
  the SOTA editors do, but Seed's `containsInlineContent: true` image already puts the caption in the document as inline
  content. The bug is DOM wrapping, not schema. A schema change means a data migration and touches every serializer.
- **Making external `<figcaption>` import into the caption.** A real gap, but it is a separate paste-mapping feature
  with its own edge cases (multiple images, figure without img, nested figures). Document current behavior in Phase 4
  and file it separately.
- **Fixing the pre-existing failures found during diagnosis** — media-surface drag not reordering, Enter not exiting the
  caption, embed-card click selecting nothing. They are real bugs but predate this work; bundling them makes the
  regression sweep unreadable.
- **Adding captions to video, file, or embed.** Only the image block has `containsInlineContent: true`. The others are
  leaf nodes and adding inline content to them is a schema change, not a wrapping fix.
- **Refactoring `BlockSelectionWrapper` generally.** It has explicit warnings about media mousedown/click ordering. Add
  the narrow opt-out; do not restructure it.
- **Generalizing the "editable island" fix across every node view.** Fix the media path that is broken and covered by
  tests.

## No Gos

- No schema change, no data migration, no change to how captions serialize into `block.text` and annotations.
- Do not remove `contentEditable={false}` from the media surface, the upload form, or any native control (file input,
  URL input, buttons). Only the caption's ancestry changes.
- Do not remove `data-media-container-ignore-select` or the `lastMousedownInCaption` guard.
- Do not change read-only reader behavior — caption fragment selection already works there and must be byte-identical
  after the fix.
- Do not change fragment-action gating: blocks without a referenceable revision still show no fragment actions.
- Do not ship on harness evidence alone. The desktop app, real publishing, and the real clipboard are untested by the
  harness and require the manual pass above.
- Do not land the fix without the Phase 1 tests demonstrably failing beforehand.
