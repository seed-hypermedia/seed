# @seed-hypermedia/extension-sdk

The iframe side of [Seed extensions](../../../extensions/README.md). An extension is a single self-contained HTML file
that a Seed host (the web app or the desktop app) loads into a sandboxed iframe. This package gives that page a typed
connection to the host: read hypermedia data, sign comments and documents as the viewer, navigate, store per-viewer
settings, and follow the host theme.

The protocol itself — message shapes, method table, permissions, error codes — lives in
[`@seed-hypermedia/client/extensions`](../client/src/extensions.ts). This package implements the client half of it and
has no runtime dependencies beyond that module (which only needs `zod`).

## Install

```sh
pnpm add @seed-hypermedia/extension-sdk
```

Inside this monorepo, depend on it with `"@seed-hypermedia/extension-sdk": "workspace:*"`.

## Quick start

```ts
import {connect, applyTheme, injectBaseStyles, ExtensionError} from '@seed-hypermedia/extension-sdk'

injectBaseStyles() // --seed-bg, --seed-fg, … CSS variables for both themes

const seed = await connect() // hello handshake; rejects if no host answers in 5 s

seed.onContext((context) => {
  applyTheme(context) // sets <html data-theme="light|dark">
  console.log('mounted at', context.mountPath, 'as', context.user?.name ?? 'anonymous')
})

const home = await seed.getResource(`hm://${seed.context.site.uid}`)

try {
  await seed.sign.comment({targetId: `hm://${seed.context.site.uid}`, markdown: 'Hello from an extension'})
} catch (error) {
  if (error instanceof ExtensionError && error.code === 'user_rejected') {
    // the viewer cancelled the confirmation dialog
  }
}
```

The bridge is asynchronous and every call returns a promise. Calls that write (`sign.*`) open a confirmation dialog in
the host; the promise settles when the viewer confirms or cancels.

## API

`connect(options?) → Promise<SeedExtension>`

| Option            | Default | Meaning                                                           |
| ----------------- | ------- | ----------------------------------------------------------------- |
| `timeoutMs`       | `5000`  | Reject with `ExtensionError('not_supported')` if no host answers. |
| `helloIntervalMs` | `250`   | `hello` is re-sent at this interval until the host answers.       |
| `sdkVersion`      | package | Reported to the host in the handshake.                            |
| `transport`       | window  | Replace the postMessage transport (tests, non-iframe embeddings). |

`SeedExtension`:

| Member                                               | Bridge method   | Notes                                                                                     |
| ---------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `context: ExtensionContext`                          | —               | Latest context; updated from `context` events.                                            |
| `onContext(cb): () => void`                          | —               | Subscribe to context changes; `cb` also runs immediately. Returns unsubscribe.            |
| `user: ExtensionUser \| null`                        | —               | Getter for `context.user`.                                                                |
| `hasPermission(p): boolean`                          | —               | Whether `context.permissions` includes `p`.                                               |
| `call(method, params)`                               | any             | Raw typed RPC: `ExtensionMethods[M]['params']` → `ExtensionMethods[M]['result']`.         |
| `query(key, input): Promise<unknown>`                | `api.query`     | Any read-only key in `EXTENSION_READ_QUERY_KEYS`. See "Hypermedia ids" below.             |
| `getResource(id, {version?}): Promise<HMResource>`   | `api.query`     | `Resource` query for an `hm://` URL.                                                      |
| `search(query, opts?): Promise<HMSearchPayload>`     | `api.query`     | `Search`; `opts` is `HMSearchInput` minus `query` (e.g. `{accountUid, pageSize}`).        |
| `fileUrl(cid): Promise<string>`                      | `file.url`      | For `<img src>` / `<video>`; `fetch` only where the host's CORS allows.                   |
| `readFile(cid, {maxBytes?}): Promise<Uint8Array>`    | `file.read`     | Bytes through the host (base64 on the wire).                                              |
| `sign.comment(params): Promise<{commentId}>`         | `sign.comment`  | `{targetId, markdown?, blocks?, targetVersion?, replyCommentVersion?, …}`. Needs `sign`.  |
| `sign.document(params): Promise<{id, version}>`      | `sign.document` | `{id, metadata?, blocks?, summary?}`; creates the document if missing. Needs `sign`.      |
| `sign.data(data, purpose): Promise<SignDataResult>`  | `sign.data`     | `data` is bytes or a UTF-8 string; result `{signature: Uint8Array, signer, accountId}`.   |
| `navigate(url, {replace?})`                          | `navigate`      | `hm://` URL or site-relative path. Needs `navigate`.                                      |
| `openExternal(url)`                                  | `openExternal`  | New tab / system browser. Needs `navigate`.                                               |
| `setRoute(subPath, query?, {replace?})`              | `route.set`     | Change the URL beneath the mount; the new `subPath`/`query` come back as a context event. |
| `storage.get(key): Promise<string \| null>`          | `storage.get`   | Per-extension, per-viewer. Needs `storage`.                                               |
| `storage.set(key, value)` / `remove(key)` / `keys()` | `storage.*`     |                                                                                           |
| `toast(message, kind?)`                              | `ui.toast`      | `kind`: `info` \| `success` \| `error`.                                                   |
| `setTitle(title)`                                    | `ui.setTitle`   |                                                                                           |
| `resize(height)`                                     | `ui.resize`     | Ask the host to size the iframe (it may clamp).                                           |
| `disconnect()`                                       | —               | Stop listening; pending calls reject with `internal`.                                     |

Other exports:

- `ExtensionError` (`.code` is an `ExtensionErrorCode`: `permission_denied`, `user_rejected`, `not_signed_in`,
  `unknown_method`, `invalid_params`, `not_supported`, `internal`) and `buildSignDataPayload` for verifying `sign.data`
  signatures — re-exported from `@seed-hypermedia/client/extensions`.
- `applyTheme(context)`, `injectBaseStyles()`, `seedBaseStyles` — theme helpers.
- `base64Encode` / `base64Decode` — the helpers the SDK uses on the wire.
- `hmRef(url, version?)` — builds the `{id}` shape described next.
- `createWindowTransport(win?)` and the `ExtensionTransport` type for custom transports.
- Types: `ExtensionContext`, `ExtensionUser`, `ExtensionPermission`, `ExtensionMethods`, `ExtensionReadQueryKey`,
  `HMResource`, `HMDocument`, `HMDocumentInfo`, `HMQueryResult`, `HMSearchPayload`.

## Hypermedia ids

The host's query API works with `UnpackedHypermediaId` objects, but parsing `hm://` URLs would pull the whole `hm-types`
module into every extension. So the SDK sends ids as **packed strings** and the host unpacks them:

- wherever the host API wants an `UnpackedHypermediaId`, the SDK sends `{id: 'hm://<uid>/<path>?v=<version>'}`;
- `getResource(id, {version})` sends `query('Resource', {id})` in that shape;
- for keys that nest an id (`ListComments`, `ListDiscussions`, `ListCitations` use `targetId`; `InteractionSummary` uses
  `id`), pass `hmRef(url)` in that field: `seed.query('InteractionSummary', {id: hmRef('hm://…')})`.

**Hosts must therefore accept `{id: string}` where `id` is an `hm://` URL** — at the top level of `Resource` and
`ResourceMetadata` inputs and in nested id fields — and convert it with `unpackHmId` before validating against the real
input schema. A version in the URL's `v` query parameter pins the document version. `Account` takes a plain uid string
and `Query` takes `{includes: [{space, path?, mode}], sort?, limit?}` with no ids, so those need no unpacking.

## Sandbox limitations

The iframe runs with `sandbox="allow-scripts allow-forms allow-popups allow-modals"` and **no** `allow-same-origin`, so
it has an opaque origin:

- **No `localStorage`, `sessionStorage`, `indexedDB` or cookies** — reading them throws. Use `seed.storage`, which the
  host keeps per extension in the viewer's browser.
- **No relative URLs.** The published entry is loaded through `srcdoc`, so `<script src="./x.js">` or
  `<img src="img.png">` have nothing to resolve against. Inline everything at build time (the examples use
  `vite-plugin-singlefile`); for hypermedia files use `seed.fileUrl(cid)` or `seed.readFile(cid)`.
- **`fetch` needs CORS.** Requests from an opaque origin carry `Origin: null`; the site's own API will usually refuse
  them. Prefer `seed.query(...)` and `seed.readFile(...)`, which go through the host.
- **`window.parent.postMessage` uses `'*'`** as the target origin because no concrete origin can match an opaque one.
  The host authenticates the extension by `event.source`; the SDK, symmetrically, only accepts messages whose `source`
  is `window.parent`.
- **Navigation is mediated.** `window.top` is inaccessible and the host ignores `<a target="_top">`; use `seed.navigate`
  / `seed.openExternal`. Popups (`allow-popups`) work but are subject to the host's policy.
- **Dev servers** (`?extdev=http://localhost:5181`) load via `src` instead of `srcdoc`, so relative URLs _do_ resolve
  there — do not rely on that; the published build must be self-contained.

## Development

```sh
pnpm --filter @seed-hypermedia/extension-sdk typecheck
pnpm --filter @seed-hypermedia/extension-sdk test      # vitest, jsdom
pnpm --filter @seed-hypermedia/extension-sdk build     # tsup (ESM) + d.ts
```

Tests drive the SDK through an in-memory `ExtensionTransport` so the handshake, retries, error mapping and events are
exercised without a browser.
