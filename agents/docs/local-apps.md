# Local apps and chat widgets (prototype)

Agents can create self-contained HTML/CSS/JavaScript apps that open in the experimental desktop browser or run inside
their chat transcript. Both views use the same immutable app revision and sandbox document. This works with local and
remote agent servers: the signed client downloads the app, and the desktop hosts that copy on its own loopback
interface. A remote server's `localhost` is never mistaken for the user's machine.

## Try it

1. Enable **Experimental web browser** in desktop Advanced settings.
2. In the agent's tool settings, enable **Create apps and widgets**. Newly created agents and assistants include Apps;
   existing grants are not silently changed. No execution backend or publishing keys are needed.
3. Ask: “Build an interactive budget calculator with sliders. Show it as a widget and give me a link to open it in the
   browser. Let me send my selected budget back to you.”
4. The widget runs in the chat as soon as it appears (**Stop widget** puts it behind a **Run widget** button), or click
   **Open in browser**. In chat, a result appears outside the app with **Send to agent** and **Dismiss** controls.
   Nothing is sent until the user chooses to send it. The resulting message has an **App context** bubble containing the
   artifact reference and the output's provenance.

The app opens in the ordinary `web` route, preserving the sidebar, title bar, footer, assistant panel, omnibar, and
browser/Seed navigation history. The local HTTP URL lasts until that Seed window closes; use the original chat link to
reopen it later. Without the desktop adapter, app links offer the sandbox inline in chat.

## Agent contract

Discover `read ~/tools/apps` through the ordinary tool index. The callable follows the existing tool-document,
promotion, grants, palette, and rendering paths.

Write a UTF-8, self-contained HTML file with `write` to `~/memory/apps/budget.html`, or use `execute` to build it at
`/workspace/apps/budget.html`. Then:

```json
{"tool": "apps", "input": {"path": "~/memory/apps/budget.html", "title": "Budget calculator"}}
```

`apps` snapshots the file into a session attachment whose ID is the SHA-256 of the package bytes. It returns:

- `url`: `seed-app:<attachment-id>` (resolved in the current chat session).
- `link`: a ready-to-use Markdown link.
- `widget`: a ready-to-use `seed-widget` fence with `{"app":"seed-app:<id>","height":400}`. Height is optional, from 200
  to 800 pixels.

Include the returned Markdown in the reply. Editing the source and calling `apps` again creates a new revision; old
messages keep their original app. The frontend verifies the hash before running it. App packages use the existing signed
`ReadSessionAttachment` authorization and session-deletion lifecycle. They are not published to Seed or IPFS. References
are session-relative; copying a reference to a different session does not grant access or transfer it.

## Minimal app

```html
<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body {
        font: 16px system-ui;
        padding: 1rem;
      }
      label {
        display: block;
        margin-bottom: 1rem;
      }
    </style>
  </head>
  <body>
    <h1>Budget calculator</h1>
    <label>Monthly budget <input id="budget" type="range" min="100" max="5000" value="1500" /></label>
    <output id="amount">1500</output>
    <button id="share">Share my budget</button>
    <script>
      const budget = document.querySelector('#budget')
      budget.oninput = () => {
        document.querySelector('#amount').textContent = budget.value
      }
      document.querySelector('#share').onclick = () => {
        parent.postMessage({type: 'seed-app-result', value: {monthlyBudget: Number(budget.value)}}, '*')
      }
    </script>
  </body>
</html>
```

The frame has an opaque origin, so the result bridge uses `postMessage` with `*`. Both relay and chat validate the exact
sending window and message type. JSON results are capped at 16 KiB. The first received proposal is frozen for review
until sent or dismissed; subsequent app messages cannot replace it during review. Only trusted controls outside the
iframe can submit a signed chat action. The result bridge is available in chat, not in the full browser view.

## Boundaries and current limits

- Single HTML file, maximum 1 MiB UTF-8. Bundle libraries, styles, and images inline; no CDN imports.
- A widget runs when it appears in a transcript; only the sandbox contains it. Raw HTML in Markdown remains inert.
- Nested sandboxed frames allow scripts but not same-origin access, forms, popups, downloads, or top navigation. CSP
  blocks external resource loads, fetch, and frame navigation; no Seed preload, signing keys, or tool bridge is
  injected. The wrapper's frame policy also constrains script-initiated navigation inside the app.
- The desktop listener is window-owned, loopback-only, random-addressed, and read-only. It rejects incorrect Host
  headers and unknown paths, serves no directories, disables caching, and closes with its window. It holds up to 64
  revisions / 32 MiB of generated wrapper HTML in memory. The attachment store's existing quotas also apply.
- State is ephemeral. Chat and full-browser views do not share live state; stopping, reopening, or refreshing starts
  over. Persistent state, backend processes, port forwarding, and capability grants are future work.
- Browser screenshots include the GUI, but the current browser tool's element refs do not traverse sandbox iframes. The
  current-window context tells the agent this and identifies the app artifact.
- This is a browser sandbox, not a CPU/memory quota or a microVM. Do not treat it as a general hardened hostile-code
  runner. An app can be computationally expensive. No persistent process is started by this feature.
- Existing session continuation only carries selected user attachments. App references should be recreated in the
  successor session; copying a reference alone does not carry its package.

The isolation uses standard
[iframe sandboxing](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) and
[CSP frame-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src).

## Tests

- Agents: revision immutability, memory path checks and size bounds, discovery/grants, signed session authorization.
- UI: run on sight, stop and restart, rerender stability, integrity failures, source-checked result messages,
  user-approved sends, integrated-browser navigation, context disclosure, and tool-grant preservation.
- Electron: real Chromium interaction in both views, image data URLs, result relay, blocked network loads/navigation,
  blocked parent DOM/storage/Node/preload access, loopback endpoint restrictions, and listener cleanup.

Run the Electron tests from the repo root:

```sh
pnpm --filter @shm/desktop exec playwright test tests/agent-apps.e2e.ts tests/web-browser.e2e.ts --project=e2e --reporter=line
```
