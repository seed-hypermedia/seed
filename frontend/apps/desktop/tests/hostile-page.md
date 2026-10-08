# App window security checks

`hostile-page.e2e.ts` bundles a small Electron main process and preload with esbuild, starts a local HTTP server, and
installs the production `installWindowGuards` and `installAppSessionGuards` on a BrowserWindow using the default
session. The implementations live outside `app-windows.ts` so importing them does not start the daemon, open the app
database, or initialize application state. `app-windows.ts` also re-exports the window installer. The fixture stubs only
OS browser launching, uses a temporary user-data directory, and needs no packaged app, daemon, accounts, or Internet
service. The test has a 30-second deadline and uses events/assertions rather than sleeps. This is a deadline, not a
measured runtime guarantee until run on the target machine.

From the repo root:

```sh
direnv exec . pnpm --filter @shm/desktop exec vitest run src/__tests__/app-window-policy.test.ts src/__tests__/app-window-security.test.ts src/__tests__/preload-ipc.test.ts
direnv exec . pnpm typecheck
direnv exec . pnpm --filter @shm/desktop exec env NODE_ENV=test npx playwright test --project=e2e tests/hostile-page.e2e.ts
```

The existing `tests/*.e2e.ts` use the packaged application fixture and require an app under `out/`. This new test uses a
page served with the actual production session CSP, rather than a packaged `index.html`.

## Behavior and compatibility

- Frames must use HTTP(S). Embed hosts match complete DNS labels under the explicitly listed registrable domains:
  YouTube, YouTube No Cookie, Twitter/X, Instagram, and CDN Instagram. Subdomains are supported; paths, queries,
  credentials, and lookalike suffixes cannot grant access. App and daemon/IPFS frames use exact configured origins,
  including a configured `SEED_ASSET_HOST` gateway. Vimeo remains unsupported by this allowlist even though the editor
  can construct Vimeo URLs.
- Blocked frames, redirects, and unexpected child windows never launch an OS application. Main-frame navigation stays
  within the exact app origin. Local server failure no longer falls back to an app page without its HTTP CSP.
- Popup requests are always denied as Electron windows. Only HTTP(S) destinations with an app referrer and live
  main-frame activation can be handed to the OS. Electron 39 exposes no reliable gesture flag in the window-open
  callback; disposition/referrer alone are insufficient. The check reads Chromium's `navigator.userActivation` in an
  isolated world, without manufacturing a gesture. Requests whose activation was consumed by `window.open`, missing
  referrers, and embed-origin popups fail closed. This can suppress legitimate popup links in embeds. The app's explicit
  external-link IPC accepts HTTP(S)/mailto, checks its sender is the main frame, and requires the same activation.
  Deferred link opens after activation expires will be denied.
- The default session denies permissions except sanitized clipboard writes from the app main frame, activated clipboard
  reads from that frame, fullscreen from the app or supported embeds hosted in the app, and activated HTTP(S)/mailto
  external-protocol requests from the app main frame. There are no browser notification, geolocation, camera, or
  microphone callers in the current frontend. Normal paste events use `clipboardData`; `value-editor.tsx` additionally
  needs async clipboard reads for its Paste action. Video fullscreen does not require the camera/microphone `media`
  permission. Device access, DRM/media-key permissions, and screen capture remain denied, so DRM videos or new device
  features would need a reviewed exception.
- `X-Frame-Options` is stripped case-insensitively only on the exact app HTTP/Vite origin, including the port. Other
  local servers and daemon responses retain their own frame protections.
- The generic main preload allows only current renderer send/listen channels. The find preload allows only its
  query/cancel sends. Unknown commands warn and do not reach `ipcRenderer`; rejected listeners return a harmless
  unsubscribe function. Dedicated APIs and the tRPC bridge are unchanged. Adding a new generic renderer channel requires
  updating `preload-ipc.ts`.

## CSP choices

The main app receives an enforced response CSP from the session in packaged builds. Loading and find pages also have
meta policies because they are loaded from disk. The redundant inline `global = globalThis` bootstraps were removed:
Vite already defines `global`. The loading page's one existing inline bootstrap is authorized by its SHA-256 hash; edits
to that script must update the hash.

The main policy starts from `default-src 'self'`, disables objects and inline script/eval execution, and limits base
URLs to self. Deliberate exceptions:

- Styles allow inline styles for Tailwind, React styles, and embed layout.
- Image/media sources allow HTTP(S), data, and blob URLs for remote content and IPFS media. Fonts allow self/data.
- Connections allow `http://localhost:* http://127.0.0.1:* https: ws://localhost:* ws://127.0.0.1:* wss:` plus
  configured service origins. Users can configure agent servers on arbitrary loopback ports (including localhost:3051),
  so these sources apply to packaged builds as well as development. HTTPS/WSS support remote agents and services;
  loopback WebSockets also support local agents and Vite HMR. Arbitrary remote HTTP/WS origins remain blocked unless
  explicitly configured as an app service.
- Frames share the navigation allowlist and exact daemon/IPFS gateway origins.
- Scripts allow self plus the exact Twitter widgets, Instagram embed, and Plausible analytics script URLs already loaded
  by the frontend. Additional scripts dynamically requested by those SDKs may be blocked and need runtime compatibility
  checking; whole HTTPS origins are not granted script execution.
- The main development response uses **Report-Only** because Vite React Refresh injects an inline preamble. Development
  connections include WebSockets for HMR. No `unsafe-eval` exception was added. The find page permits WebSocket
  connections for its Vite HMR; its script policy remains enforced. Development is consequently not an enforcement test
  for the packaged main app CSP.

Before release, run this suite, the existing packaged Electron e2e tests, and an isolated alternate-port dev app.
Inspect CSP console reports while opening the editor, loading/find pages, and social/video embeds. The hostile fixture
exercises production CSP enforcement but cannot establish third-party embed SDK compatibility.
