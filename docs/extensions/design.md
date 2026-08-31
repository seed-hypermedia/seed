# Seed Extensions — Design

Status: **implementation spec** for branch `feat/extensions` (started 2026-08-31). This is the document the
implementation is built against. Narrative docs for extension developers and site owners live beside it (see
`README.md`).

## 1. Goal

Let third parties build **full-page apps that run inside a Seed site** — a site dashboard, a kanban board over a set of
documents, a custom directory — on both the web app and the desktop app, with these properties:

- The extension is **ordinary HTML/JS/CSS** in a sandboxed iframe. Any framework works.
- The extension can **read hypermedia data** and **sign as the current user** (comments, document changes, arbitrary
  data) through a bridge; **it never sees a key**.
- The extension is **distributed as hypermedia data**: a signed, versioned, content-addressed document that syncs
  peer-to-peer like everything else.
- A site **installs** an extension by writing a record into its home document. Installation is therefore also just
  signed data.
- Developers get a **hot-reload loop** against the real host app.

Everything here is designed so the same packaging, install and bridge layers can later host other extension kinds
(custom blocks, attribute editors, themes).

## 2. Vocabulary

| Term                   | Meaning                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Extension**          | A hypermedia document with a `seedExtension` manifest in its metadata. "Plugin" is a synonym.                            |
| **Extension document** | That document, `hm://<authorUid>/<path>`. Its body is the README shown on its own page.                                  |
| **Entry**              | The extension's code: one self-contained HTML file stored as an IPFS file, referenced from the manifest.                 |
| **Install record**     | An entry in a site home document's `metadata.extensions` map, keyed by mount path.                                       |
| **Mount path**         | The path under the site where the extension page is served, e.g. `board` → `https://site/board`, `hm://<siteUid>/board`. |
| **Host**               | The app rendering the extension: web (`frontend/apps/web`) or desktop (`frontend/apps/desktop`).                         |
| **Bridge**             | The postMessage RPC between host and extension iframe.                                                                   |
| **SDK**                | `@seed-hypermedia/extension-sdk`, the tiny client used inside the iframe.                                                |

## 3. Data model

All schemas live in `frontend/packages/client/src/extensions.ts` (published in `@seed-hypermedia/client`). That file is
normative; this section summarises it.

### 3.1 Manifest — `metadata.seedExtension` on the extension document

```jsonc
{
  "manifestVersion": 1,
  "kind": "page", // page | block | attribute | theme (only page implemented)
  "version": "0.1.0", // informational semver
  "entry": "ipfs://bafk...", // single self-contained HTML file
  "description": "Kanban board over site documents",
  "permissions": ["sign", "navigate", "storage"],
  "defaultMountPath": "board",
  "homepage": "https://github.com/..."
}
```

Permissions: `sign` (comments, document changes, arbitrary data — each request is user-confirmed), `navigate` (navigate
the host, open external URLs), `storage` (per-extension key/value in the viewer's browser). Reading is implicit.

The document's `name` is the extension's display name; the body is its README.

### 3.2 Install record — `metadata.extensions` on the site home document

```jsonc
{
  "extensions": {
    "board": {
      "ext": "hm://z6MkAuthor.../kanban",
      "version": "bafy...", // pinned extension document version (default)
      "title": "Board", // optional nav title
      "nav": true, // optional, default true
      "settings": {"columns": 4} // optional, passed to the extension context
    }
  }
}
```

Keyed by mount path (mirrors the existing `spaceAgents` record convention so the metadata editor and
`getDocAttributeChanges` handle it). Removing a key via the metadata editor leaves `null`; readers ignore nulls.

**Version pinning.** `version` is the extension _document_ version at install time. The host resolves the manifest from
exactly that version, so the code a site runs cannot change under it when the author publishes an update. Omitting
`version` follows latest. Install UIs pin by default and offer an explicit update.

### 3.3 Resolution

`resolveExtensionMount(homeMetadata, pathSegments)` finds the longest install whose mount segments prefix the requested
path and returns `{mountPath, record, subPath}`. `subPath` (segments after the mount) is handed to the extension for its
own routing, e.g. `/board/card/abc` → mount `board`, subPath `['card','abc']`.

A mount shadows any document at or beneath the same path in the page UI. The document still exists and is addressable
through the API — extensions commonly use the document at their mount path as their data store (kanban does).

## 4. Rendering

Both hosts already render "site header + custom body" through `PageWrapper` in
`frontend/packages/ui/src/resource-page-common.tsx` (`feed-page-common.tsx` is the reference). Extension pages reuse it.

### 4.1 `@shm/ui` — `extensions/`

- `ExtensionPage` — `{docId, siteHomeDocument | undefined, mount, rightActions?}`. Renders `PageWrapper` with the site
  header and, as body, `ExtensionFrame`. Resolves the extension document via
  `useResource(hmId(ext.uid, {path, version: record.version, latest: !record.version}))`, parses the manifest, and shows
  friendly states: loading, "not an extension", "extension unavailable", "extension needs update (protocol)".
- `ExtensionFrame` — owns the `<iframe>` and the bridge server.
  - Sandbox: `allow-scripts allow-forms allow-popups allow-modals allow-downloads`. **Never** `allow-same-origin`.
  - Loading: fetches the entry HTML as text via the host adapter (`fetchEntryHtml(cid)`) and sets `srcdoc`. With a dev
    override the iframe uses `src=<devUrl>` instead (still sandboxed).
  - Only accepts messages where `event.source === iframe.contentWindow`.
  - Fills the available height; `ui.resize` is honoured only in embedded contexts (future block use).
- `bridge-server.ts` — framework-free `createExtensionBridgeServer({target, adapter, getContext})` that decodes
  requests, enforces `EXTENSION_METHOD_PERMISSIONS`, dispatches to the adapter, and serialises results/errors.
  Unit-testable with fake windows.
- `sign-confirm-dialog.tsx` — the native confirmation shown for every `sign.*` call: what will be signed (comment
  preview / document + metadata diff summary / purpose string for raw data), as whom, by which extension, with **Approve
  / Deny** and an "Allow this extension to sign for the rest of this session" checkbox.
- `extension-host-context.tsx` — `ExtensionHostProvider` / `useExtensionHost()`. The host adapter is the _only_
  platform-specific piece:

```ts
export type ExtensionHostAdapter = {
  platform: 'web' | 'desktop'
  /** Signed-in viewer for this site, or null. Re-render the provider when it changes. */
  user: {accountId: string; name?: string} | null
  theme: 'light' | 'dark'
  /** Public origin of the site when known (web only). */
  siteOrigin?: string
  /** Fetch the entry HTML by CID. web: /hm/api/file/<cid>; desktop: <daemon http>/ipfs/<cid>. */
  fetchEntryHtml: (cid: string) => Promise<string>
  /** URL an iframe can use for a CID (web: absolute /hm/api/file/<cid>; desktop: daemon URL). */
  fileUrl: (cid: string) => string
  /** Read a file's bytes through the host. */
  readFile: (cid: string, maxBytes: number) => Promise<{bytes: Uint8Array; contentType?: string}>
  /** Navigate the host app (hm:// or site-relative). */
  navigate: (url: string, opts: {replace?: boolean}) => void
  openExternal: (url: string) => void
  /** Update the URL beneath the mount without leaving the page. */
  setRoute: (subPath: string[], query: Record<string, string> | undefined, opts: {replace?: boolean}) => void
  toast: (message: string, kind: 'info' | 'success' | 'error') => void
  /** Storage namespace (defaults to localStorage on both platforms). */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
}
```

Reads and writes are **not** in the adapter — they go through the existing `useUniversalClient()` (`request(key, input)`
for reads, `getSigner()` + `publish()` / `publishDocument()` for writes), which both apps already provide.

### 4.2 Web (`frontend/apps/web`)

- `routes/$.tsx` `loadRoute`: after `loadSiteHeaderData`, if the home document's metadata resolves an extension mount
  for the request path, return a payload `{kind: 'extension', mount, siteHeader...}`; `UnifiedDocumentPage` renders
  `<WebExtensionPage>` which wraps `ExtensionPage` in `ExtensionHostProvider` with the web adapter (user from
  `useLocalKeyPair()` / `useWebAccountUid()`, theme from `ThemeContext`, `fetchEntryHtml` via `/hm/api/file/<cid>`,
  `navigate` via `useNavigate`/`openUrl`).
- The iframe is client-only: SSR renders the header and a placeholder; the frame mounts after hydration.
- `hm.api.file.$` must send CORS headers (extensions live at an opaque origin).
- Dev override: `?extdev=http://localhost:5181` on an extension page writes
  `localStorage['seed.extensions.devOverrides'][extensionId]`; `?extdev=off` clears it. A small dev banner over the
  frame shows when an override is active.

### 4.3 Desktop (`frontend/apps/desktop`)

- `pages/desktop-resource.tsx`: before rendering `ResourcePage` for a `document` route, resolve the mount from the
  space's home document; if found render `<DesktopExtensionPage>` (same `ExtensionPage` inside an
  `ExtensionHostProvider` with the desktop adapter: user from `useSelectedAccount()`, `fetchEntryHtml` via the daemon
  HTTP file URL, `navigate` via `useNavigate`, `openExternal` via the existing shell-open IPC).
- Site settings gets an **Extensions** tab (`pages/site-settings.tsx`): list installs from the home document metadata,
  add by `hm://` URL (fetch → show manifest + permissions → choose mount path, pinned by default), remove, update to
  latest. Writes via `useUpdateHomeDocument`.
- Settings → Advanced → DEVELOPERS gets an **Extension dev overrides** editor (extension id → dev URL) backed by the
  same localStorage key.
- Site navigation lists installs with `nav !== false`.

## 5. Bridge protocol

Normative types: `ExtensionMethods`, `ExtensionEvents`, message shapes in `extensions.ts`. Summary:

- Transport: `postMessage`. Iframe→host targets `window.parent` with `'*'` (opaque origin has no usable origin string).
  Host→iframe targets `iframe.contentWindow` with `'*'` for the same reason; the host trusts only
  `event.source === iframe.contentWindow`.
- Every message: `{ "seed-extension": 1, type: 'request'|'response'|'event', ... }`.
- Handshake: SDK sends `hello` (retrying until answered); host replies with the `ExtensionContext`. Host pushes
  `context` events on any change (user, theme, route).
- Reads: `api.query {key, input}` restricted to `EXTENSION_READ_QUERY_KEYS`. The host accepts `hm://` **strings** for
  `id` fields in `Resource`, `ResourceMetadata` and `Query` inputs and unpacks them (the SDK stays dependency-free).
- Writes: `sign.comment`, `sign.document`, `sign.data` — each requires the `sign` permission, a signed-in user, and user
  confirmation.
  - `sign.document` builds a change with `metadata` set-attribute ops (null → delete) and optional full body replace via
    `blocks`; host publishes with `universalClient.publishDocument`.
  - `sign.data` signs `buildSignDataPayload(extensionId, bytes)` — a domain separated prefix so an extension signature
    can never be replayed as a protocol blob. Returns signature, signer principal and account id.
- Errors: `{code, message}` with codes
  `permission_denied | user_rejected | not_signed_in | unknown_method | invalid_params | not_supported | internal`.

## 6. Security model

- **Sandbox.** Opaque origin, no cookies/storage of the host, no DOM access, no same-origin fetch. The entry HTML is
  inert bytes until loaded into the sandbox; the host never `eval`s it.
- **Keys never cross the bridge.** Signing goes through `HMSigner` on the host (web: non-extractable WebCrypto device
  key holding a vault delegation; desktop: daemon `SignData`). The iframe gets bytes back, never key material.
- **Every signature is confirmed** by a native dialog naming the extension, the account and the effect. A session-scoped
  "always allow" exists for convenience; it is never persisted.
- **Domain separation** for raw signatures (`sign.data`).
- **Version pinning** by document version CID: the site owner chooses when the code they run changes.
- **Permissions** are declared in the manifest and enforced per method; the install UI shows them.
- **Install is signed data** — only holders of write capability on the site's home document can install.
- Non-goals for v1: network egress control (the iframe can `fetch` any CORS endpoint), resource limits, cross-extension
  isolation beyond separate iframes.

## 7. Developer workflow

1. `pnpm create` a vite project (or copy `extensions/examples/hello-signer`). Build to one file with
   `vite-plugin-singlefile`.
2. `pnpm dev` (fixed port). Open the extension page in the host with `?extdev=http://localhost:5181` (web) or set the
   override in desktop Settings → Advanced. The iframe now loads the dev server with HMR.
3. `seed-cli extension publish ./ --key mykey -p my-ext` → uploads `dist/index.html` to IPFS, writes the manifest into
   the extension document's metadata, README as body.
4. `seed-cli extension install hm://<me>/my-ext --path board --key sitekey` (or desktop Site settings → Extensions).
5. Iterate: publish a new version; sites that pinned see "update available".

## 8. CLI (`frontend/apps/cli/src/commands/extension.ts`)

- `extension publish <dir> [-p path] [--key] [--entry dist/index.html] [--manifest seed-extension.json] [--readme README.md] [--name]`
- `extension inspect <hm-url>` — prints manifest, entry CID, permissions, version.
- `extension install <hm-url> --path <mount> [--key sitekey] [--latest] [--title] [--no-nav]`
- `extension uninstall --path <mount> [--key]`
- `extension list [<site hm-url>]`
- `extension update --path <mount>` — re-pin to the extension's latest version.

## 9. Testing

- Unit: `client/src/extensions.test.ts`; SDK tests (fake parent window); `ui` bridge-server tests (permission
  enforcement, error mapping, hm:// id unpacking, confirm flow).
- CLI fixture test: publish an extension from a fixture dir, install on the fixture site, `document get` shows the
  record, `GET /<mount>` on the web server returns the extension page shell.
- Browser test (Playwright, `tests/`): load the mounted page, assert the sandboxed iframe exists, that `hello` completes
  (the hello-signer example renders the context), and that a `sign.data` request opens the confirmation dialog and
  resolves after approval.
- Manual: desktop + web against mainnet with the examples published under the starlight space.

## 10. Roadmap / overlap with other extension kinds

The packaging (document + manifest), install records, resolution, bridge, permission model, confirmation dialog, dev
overrides and CLI are all kind-agnostic. To add:

- **Custom block** — `kind: 'block'`, `contributes.blocks[]`, the same `ExtensionFrame` mounted per block with
  `ui.resize` honoured, block attributes passed in context, `block.setAttributes` bridge method.
- **Attribute UI** — `kind: 'attribute'`, frame mounted inside the metadata editor.
- **Theme** — `kind: 'theme'`, no code; manifest carries CSS variables.
- **Template UI modality** — a second host implementing the same bridge with native components instead of an iframe
  (mobile).
