---
name: testing-editor-harness
description: How to run and manually test the editor E2E harness for the @shm/editor package, including mobile viewport emulation, supernumber badges, and mobile comment UX interactions.
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

`real=1` mounts the actual `DocumentEditor` with a mock document machine; `fixture=allBlocks` renders one of every block type defined in `e2e/test-app/TestEditor.tsx`; `badges=1` gives every fixture block a mock citation/comment count so supernumber badges render.

## Mobile viewport emulation
The Chrome for Testing instance in this environment listens on remote-debugging port `29229`. Use CDP to set a mobile viewport without keeping DevTools open:

```javascript
// /tmp/set-mobile-viewport.js
const http = require('http');
const WebSocket = require('ws');

http.get('http://localhost:29229/json/list', (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    const pages = JSON.parse(data);
    const page = pages.find((p) => p.url.includes('localhost:5180') && p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id: 1, method: 'Emulation.setDeviceMetricsOverride', params: {
        width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
        screenWidth: 390, screenHeight: 844,
      }}));
      ws.send(JSON.stringify({id: 2, method: 'Emulation.setTouchEmulationEnabled', params: {enabled: true}}));
      setTimeout(() => ws.close(), 500);
    });
  });
});
```

Verify with `window.innerWidth` and `window.innerHeight` in the console.

## Key DOM selectors
- Editor container: `[data-testid="editor-container"]`
- Block nodes: `[data-node-type="blockNode"][data-id]`
- Paragraph content: `[data-node-type="blockNode"][data-id="p-top"] [data-content-type="paragraph"]`
- Supernumber badges: `.bn-supernumber-badge`
- Block hover actions card: `[data-bn-block-hover-actions="true"]`
- Range selection bubble: buttons with `aria-label="Copy link to selection"` or `aria-label="Comment on selection"`, inside a `bg-popover ... rounded-md border ... shadow-md` element

## Useful runtime globals
- `window.TEST_EDITOR` (raw / default mode) — exposes `hoverActionsBlockId()`, `blockToolsBlockId()`, `getSelection()`, `getBlocks()`, etc.
- `window.TEST_MACHINE` (`?real=1`) — exposes `state()` and `send()` for the document machine actor.
- `window.TEST_BLOCK_TOOL_CALLS` — records `{copyLink, comment}` calls made by the `BlockHoverActions` card in `?real=1`.

## Triggering touch interactions
The `BlockHoverActions` plugin only responds to `pointerdown`/`pointerup` events whose `pointerType` is not `mouse`. A real mouse click will not open the mobile card. In a real touch scenario, a tap also produces a `click`, which `useReadOnlyClickToEdit` handles and may start editing. For recording/diagnostic purposes, dispatch synthetic pointer events directly:

```javascript
const content = document.querySelector('[data-node-type="blockNode"][data-id="p-top"] [data-content-type="paragraph"]');
const rect = content.getBoundingClientRect();
const x = rect.left + rect.width / 2;
const y = rect.top + rect.height / 2;
content.dispatchEvent(new PointerEvent('pointerdown', {pointerType:'touch', bubbles:true, isPrimary:true, clientX:x, clientY:y}));
await new Promise(r => setTimeout(r, 30));
content.dispatchEvent(new PointerEvent('pointerup', {pointerType:'touch', bubbles:true, isPrimary:true, clientX:x, clientY:y}));
```

## Triggering RangeSelection
Make a non-empty text selection inside a block (e.g. long-press and drag on a touch device, or click-drag with a mouse) and release. The plugin settles after 10 ms, then opens the horizontal bubble above the selection.

## Common pitfalls
- `Emulation.setTouchEmulationEnabled` is deprecated in newer CDP versions; if it stops working, use `Emulation.setEmitTouchEventsForMouse` or a newer `Emulation` domain method.
- The `allBlocks` fixture intentionally uses a broken web-embed URL and a draft embed; expect `Error loading embed` and `Draft card` content — these are not failures.
