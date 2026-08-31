# Seed extensions

An extension is a hypermedia document. Its metadata holds a manifest (`seedExtension`), and its code is one
self-contained HTML file stored on IPFS and referenced from the manifest. A site installs an extension by adding an
install record to its home document metadata (`extensions`), keyed by the path the extension is mounted at. Everything
is signed and content-addressed, so extensions travel over the network like any other document.

At runtime the host app (web or desktop) loads the HTML into a sandboxed iframe
(`sandbox="allow-scripts allow-forms allow-popups allow-modals"`, no `allow-same-origin`, via `srcdoc`) and the two
sides talk over `postMessage`. The wire protocol, manifest and install-record schemas are defined once in
[`frontend/packages/client/src/extensions.ts`](../frontend/packages/client/src/extensions.ts); the iframe side is
wrapped by [`@seed-hypermedia/extension-sdk`](../frontend/packages/extension-sdk/README.md).

## Layout

```
extensions/
  README.md                 ← this file
  examples/
    hello-signer/           ← vanilla TS; the smallest extension, exercises every bridge method (port 5181)
    site-dashboard/         ← vanilla TS; read-only site overview using api.query (port 5182)
    kanban/                 ← React 18; board state stored in a document's metadata (port 5183)
frontend/packages/extension-sdk/   ← the SDK the examples use
```

Each example is a small Vite project that builds to a single `dist/index.html` with
[`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile). Every example has:

| File                  | Purpose                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `seed-extension.json` | The manifest, minus `entry` (the CLI fills that in from the built file at publish time). |
| `README.md`           | Becomes the body of the extension document when published — the long-form description.   |
| `index.html`, `src/`  | The app. Plain CSS in `src/styles.css`; no CSS framework.                                |
| `vite.config.ts`      | `viteSingleFile()`, a fixed dev port with `strictPort`, and `server.cors: true`.         |

## Building

From the repo root (after `pnpm install`):

```sh
pnpm --filter @seed-extensions/hello-signer build
pnpm --filter @seed-extensions/site-dashboard build
pnpm --filter @seed-extensions/kanban build
```

Each produces `dist/index.html` — the only artifact that gets published. It must be self-contained: no `<script src>` or
`<link href>` pointing at relative paths, because under `srcdoc` there is no base URL to resolve them against.

## Running in development

Start an example's dev server:

```sh
pnpm --filter @seed-extensions/kanban dev      # http://localhost:5183
```

Then open a site that has the extension installed (or where you have installed a placeholder version) and add
`?extdev=http://localhost:5183` to the page URL at the extension's mount path. The host stores the override in
`localStorage` and points the iframe at the dev server instead of the published entry — still sandboxed, still speaking
the same protocol — so Vite hot reload works end to end. Use `?extdev=off` to go back to the published code. The context
the extension receives has `dev: true` while an override is active.

The dev server must allow cross-origin module loads (`server.cors: true`) because the sandboxed iframe has an opaque
origin. Keep `strictPort: true` so the override URL stays valid across restarts.

## Publishing and installing with the CLI

```sh
# Build first, then publish the directory: reads seed-extension.json and README.md,
# uploads dist/index.html to IPFS, fills in `entry`, and writes the extension document.
seed-cli extension publish extensions/examples/kanban

# Inspect a published extension: manifest, version, permissions, entry CID.
seed-cli extension inspect hm://<author-uid>/kanban

# Install it on a site at a mount path, signing the site's home document with the site key.
seed-cli extension install hm://<author-uid>/kanban --path board --key <sitekey>
```

`install` pins the extension document version by default, so later publishes by the author do not change what the site
runs until the site owner re-installs.

## Writing your own

1. Copy `examples/hello-signer` (vanilla) or `examples/kanban` (React), rename the package, pick a free dev port.
2. Edit `seed-extension.json`: `description`, `permissions` (only what you need — `sign`, `navigate`, `storage`; reading
   is implicit), `defaultMountPath`.
3. `const seed = await connect()` from `@seed-hypermedia/extension-sdk`, then call `seed.onContext(applyTheme)` so the
   page follows the host theme. See the SDK README for the full API and the sandbox constraints (no `localStorage`, no
   cookies, no relative URLs — use `seed.storage`, `seed.query`, `seed.readFile`).
4. Build, publish, install.
