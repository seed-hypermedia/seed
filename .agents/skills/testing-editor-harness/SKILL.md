---
name: testing-editor-harness
description:
  How to run and manually test the editor E2E harness for the @shm/editor package, including mobile viewport emulation,
  supernumber badges, and mobile comment UX interactions.
---

# Testing the editor E2E harness

## Devin Secrets Needed

None.

## Environment

- Work from `frontend/packages/editor`.
- Use Node 22.22.x and the pnpm fallback at `/home/ubuntu/.local/bin/pnpm` if `mise`/corepack is rate-limited.
- The harness uses Vite: `pnpm test:harness` runs `vite --config e2e/vite.config.ts` on `http://localhost:5180`.

## Running the harness

```bash
export PATH="/home/ubuntu/.local/bin:/home/ubuntu/.local/share/mise/installs/node/22.22.0/bin:$PATH"
cd /home/ubuntu/repos/seed/frontend/packages/editor
pnpm test:harness
```

Open the browser at a real-mode fixture URL, e.g.:

```
http://localhost:5180/?real=1&fixture=allBlocks&badges=1
```

- `real=1` mounts the actual `DocumentEditor` with a mock document machine.
- `fixture=allBlocks` renders one of every block type defined in `e2e/test-app/TestEditor.tsx`.
- `badges=1` gives every fixture block a mock citation/comment count so supernumber badges render.

## Mobile viewport emulation

The Chrome for Testing instance in this environment listens on remote-debugging port `29229`. Use CDP to set a mobile
viewport without keeping DevTools open:

```javascript
// /tmp/set-mobile-viewport.js
const http = require('http')
const WebSocket = require('/home/ubuntu/repos/seed/node_modules/ws')

http.get('http://localhost:29229/json/list', (res) => {
  let data = ''
  res.on('data', (c) => (data += c))
  res.on('end', () => {
    const pages = JSON.parse(data)
    const page = pages.find((p) => p.type === 'page' && (p.url.includes('localhost:5180') || p.url === 'about:blank'))
    if (!page) {
      console.error('No suitable page found')
      process.exit(1)
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Page.navigate',
          params: {url: 'http://localhost:5180/?real=1&fixture=allBlocks&badges=1'},
        }),
      )
      setTimeout(() => {
        ws.send(
          JSON.stringify({
            id: 2,
            method: 'Emulation.setDeviceMetricsOverride',
            params: {
              width: 390,
              height: 844,
              deviceScaleFactor: 2,
              mobile: true,
              screenWidth: 390,
              screenHeight: 844,
            },
          }),
        )
        ws.send(JSON.stringify({id: 3, method: 'Emulation.setTouchEmulationEnabled', params: {enabled: true}}))
        setTimeout(() => ws.close(), 500)
      }, 300)
    })
  })
})
```

Verify with `window.innerWidth` and `window.innerHeight` in the console.

## Key DOM selectors

- Editor container: `[data-testid="editor-container"]`
- Block nodes: `[data-node-type="blockNode"][data-id]`
- Paragraph content: `[data-node-type="blockNode"][data-id="p-top"] [data-content-type="paragraph"]`
- Supernumber badges: `.bn-supernumber-badge`
- Block hover actions card: `[data-bn-block-hover-actions="true"]`
- Range selection bubble: buttons with `aria-label="Copy link to selection"` or `aria-label="Comment on selection"`,
  inside a `bg-popover ... rounded-md border ... shadow-md` element

## Useful runtime globals

- `window.TEST_EDITOR` (`?real=1`) — exposes `hoverActionsBlockId()`, `blockToolsBlockId()`, `getSelection()`,
  `getBlocks()`, etc.
- `window.TEST_MACHINE` (`?real=1`) — exposes `state()` and `send()` for the document machine actor.
- `window.TEST_BLOCK_TOOL_CALLS` — records `{copyLink, comment}` calls made by the `BlockHoverActions` card in
  `?real=1`.

## Triggering touch interactions

The `BlockHoverActions` plugin only responds to `pointerdown`/`pointerup` events whose `pointerType` is not `mouse`. A
real mouse click will not open the mobile card. In a real touch scenario, a tap also produces a `click`, which
`useReadOnlyClickToEdit` handles and may start editing. For recording/diagnostic purposes, dispatch synthetic pointer
events directly:

```javascript
const content = document.querySelector('[data-node-type="blockNode"][data-id="p-top"] [data-content-type="paragraph"]')
const rect = content.getBoundingClientRect()
const x = rect.left + rect.width / 2
const y = rect.top + rect.height / 2
content.dispatchEvent(
  new PointerEvent('pointerdown', {pointerType: 'touch', bubbles: true, isPrimary: true, clientX: x, clientY: y}),
)
await new Promise((r) => setTimeout(r, 30))
content.dispatchEvent(
  new PointerEvent('pointerup', {pointerType: 'touch', bubbles: true, isPrimary: true, clientX: x, clientY: y}),
)
```

## Triggering RangeSelection

On a real touch device, long-pressing text and adjusting the selection handles creates the selection, and the
`RangeSelection` plugin opens the bubble after `touchend`/10 ms settle.

In the harness under CDP device emulation, a real mouse drag across the read-only `contenteditable=false` editor may
leave only a collapsed caret. To demonstrate the bubble reliably, set both the native selection and the ProseMirror
selection, then dispatch `mouseup` on the editor DOM:

```javascript
const view = window.TEST_EDITOR.editor._tiptapEditor.view
const TextSelection = view.state.selection.constructor
view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 18)))

const content = document.querySelector('[data-node-type="blockNode"][data-id="p-top"] [data-content-type="paragraph"]')
const textNode = Array.from(content.childNodes).find((n) => n.nodeType === Node.TEXT_NODE)
if (textNode) {
  const sel = window.getSelection()
  sel.removeAllRanges()
  const range = document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, textNode.length)
  sel.addRange(range)
}

await new Promise((r) => setTimeout(r, 20))
view.dom.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, clientX: 100, clientY: 100}))
```

## Testing fragment selections (`#blockId[start:end]`)

Fragment actions (Comment / Copy link on a text range) are gated by `getSelectionFragment()` in
`src/hm-formatting-toolbar.tsx`, which requires a non-empty single-block text selection **and**
`getReferenceableRevision(blockNode)`. Fixture blocks in `e2e/test-app/TestEditor.tsx` have no `revision`, so out of the
box **no** block shows fragment actions and a "feature is broken" conclusion would be bogus. When testing fragment
behavior:

- Temporarily add `props.revision` to the fixture blocks under test (e.g. `p-top`, `blk-image`), and always keep a
  plain-paragraph control in the same page state.
- Read the emitted range from `window.TEST_BLOCK_TOOL_CALLS` (`{copyLink, comment}`), or add a temporary fixed-position
  log panel in `TestEditor.tsx` so the range is visible in a recording.
- Typing into a block invalidates its revision — do the fragment assertions before mutating text.

When testing highlight consumers, drive the plugin through the React props used by the real editor (`focusBlockId`,
`focusBlockRange`, and `citationFragmentHighlights`). Console-dispatched plugin metas such as
`view.dispatch(tr.setMeta(blockHighlightPluginKey, ...))` are swallowed in this harness and are not a reliable
substitute for the component path.

The harness resets window scroll to `0` about a second after a scroll. Measure scroll targets synchronously after the
navigation or scroll action; delayed assertions can observe the harness reset instead of the behavior under test.

## Selection inside media inline content (image captions)

An image caption is the image node's ProseMirror inline content (`<InlineContent className="image-caption">` in
`src/media-container.tsx`). In edit mode, selecting caption text may highlight in the DOM while ProseMirror sees
nothing. Verified causes (live DOM dump, harness `?real=1&fixture=allBlocks`):

1. `BlockSelectionWrapper` (rendered from `src/media-render.tsx`) puts a `contentEditable={false}` div between the
   caption and `view.dom`. The caption's own `contentEditable={true}` therefore becomes a **separate editing host**:
   `document.activeElement` is the caption div, `view.hasFocus()` is false, and prosemirror-view's
   `hasFocusAndSelection()` discards every selection change. The formatting toolbar never shows because
   `FormattingToolbarPlugin.shouldShow` requires `view.hasFocus()` — that gate is a symptom, not a separate bug.
2. The MediaContainer outer wrapper has `draggable={canAuthor ? 'true' : 'false'}` and wraps the caption, so a caption
   mouse drag becomes a native HTML5 drag and collapses to a caret.

Diagnostic recipe worth reusing for any "text won't select inside a node view" report — dump the ancestor chain and
toggle the two attributes at runtime before theorising:

```javascript
const el = document.querySelector('.image-caption') // or any contentDOM
const view = window.TEST_EDITOR.editor._tiptapEditor.view
for (let n = el; n; n = n.parentElement) {
  console.log(
    n.tagName,
    JSON.stringify(n.className),
    'ce=',
    n.getAttribute('contenteditable'),
    'draggable=',
    n.getAttribute('draggable'),
    n === view.dom ? '<= view.dom' : '',
  )
  if (n === view.dom) break
}
// then: ancestor.setAttribute('contenteditable','true'); outer.setAttribute('draggable','false');
// and re-check: view.hasFocus(), document.activeElement, view.state.selection, and
// !!document.querySelector('[data-testid="formatting-toolbar"]')
```

Behaviors that look like regressions but are **pre-existing** in this harness — always re-run them on an unpatched tree
before blaming a change: dragging an image by its media surface does not reorder the block (a native drag starts and
drop indicators appear, but the block order is unchanged on release), and clicking an embed card selects nothing.

### Enter / Shift+Enter inside an image caption

Enter in a caption is handled by the ProseMirror keymap (`KeyboardShortcuts/KeyboardShortcutsExtension.ts`), not by a
React `onKeyDown` on the caption. Expected behavior when testing it:

- Enter moves the selection out of the caption to the block after the image; the caption text is unchanged and the image
  block is never split.
- If the next block is an **atom** (video / file / embed / web-embed), the resulting selection is a `NodeSelection` on
  that node, not a text caret — assert `pmSelection().kind === 'NodeSelection'`. Re-wrapping
  `TextSelection.near(...).from` in `TextSelection.create()` is the bug shape to watch for; it produces an invalid caret
  / `RangeError` for atoms.
- If the image is the last block, Enter appends a paragraph and puts the caret in it. This case is hard to reach
  manually because the editor keeps an empty trailing paragraph at the end of the document; prefer the Playwright spec
  (`e2e/tests/image-caption.e2e.ts`) for it.
- Shift+Enter stays inside the caption and inserts a line break (caption text gains `\n`, block count unchanged).

If a future change reverts the caption to a separate editing host, the symptom is Enter/typing/selection silently doing
nothing in the caption — dump the ancestor chain (recipe above) before anything else.

## Common pitfalls

- `?badges=1` is required in the harness to render `.bn-supernumber-badge` widgets.
- `Emulation.setTouchEmulationEnabled` is deprecated in newer CDP versions; if it stops working, use
  `Emulation.setEmitTouchEventsForMouse` or a newer `Emulation` domain method.
- The `allBlocks` fixture intentionally uses a broken web-embed URL and a draft embed; expect `Error loading embed` and
  `Draft card` content — these are not failures.
- External `<img>` / `<figure><img><figcaption>` HTML pastes are handled by `handle-local-media-paste-plugin.ts`, which
  `fetch`es the image URL and uploads it. In an offline box this logs
  `Error processing pasted HTML image: TypeError: Failed to fetch` and inserts nothing — that is an environment
  limitation, not a parsing bug. Use a `data:` URL or a locally served image if you need this path to succeed.
- CDP `Emulation.setDeviceMetricsOverride` survives page reloads and is **not** undone when the websocket closes right
  after `clearDeviceMetricsOverride`; keep the CDP connection open for a moment after clearing, or check
  `window.innerWidth` to confirm the override is gone before continuing desktop tests. Chrome also rejects CDP
  websockets with `403` unless the client suppresses the `Origin` header
  (`websocket.create_connection(..., suppress_origin=True)`).
- On a touch viewport, a plain long-press does not create a text selection; long-press, then move the pointer a few
  pixels before releasing to get a real range. A double-tap on an image opens the gallery lightbox instead.
- Do not set a `TextSelection` to block-node boundary positions (e.g. 0, 1, or 19); this produces a
  `blockChildren`/`blockNode` endpoint warning and may fail to trigger the desired UI.
