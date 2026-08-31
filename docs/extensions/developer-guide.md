# Extension developer guide

How to build, run, publish and get a Seed extension installed. This is the narrative companion to
[bridge-api.md](./bridge-api.md) (the reference) and [design.md](./design.md) (the spec). The three examples in
[`/extensions/examples`](../../extensions/examples) are the source of every snippet here.

## What an extension is

An extension is an ordinary web page — HTML, JS, CSS, any framework — that a Seed host (the web app or the desktop app)
loads into a sandboxed iframe under the site header at a **mount path** such as `https://example.site/board`. The page
talks to the host over `postMessage` through `@seed-hypermedia/extension-sdk`: it can read hypermedia data, ask the
viewer to sign comments, document changes and arbitrary bytes, navigate the host, and keep per-viewer settings. It never
holds a key. The extension itself is a hypermedia document: its metadata carries the manifest below, its body is your
README, and its code is one self-contained HTML file stored on IPFS and referenced by CID. Publishing an update produces
a new document version; sites pin the version they installed.

The manifest (`metadata.seedExtension` on the extension document — the CLI writes it from `seed-extension.json`):

```jsonc
{
  "manifestVersion": 1,
  "kind": "page", // only `page` is implemented today
  "version": "0.1.0", // informational semver; the document version is the real identity
  "entry": "ipfs://bafk...", // filled in by `seed-cli extension publish` from dist/index.html
  "description": "A kanban board stored in the metadata of the document it is mounted at.",
  "permissions": ["sign", "navigate", "storage"], // reading needs no permission
  "defaultMountPath": "board", // suggestion; the site owner can change it
  "homepage": "https://github.com/seed-hypermedia/seed/tree/main/extensions/examples/kanban",
  "minProtocol": 1 // optional: refuse to run on hosts older than this bridge protocol
}
```

The schema is `ExtensionManifestSchema` in
[`frontend/packages/client/src/extensions.ts`](../../frontend/packages/client/src/extensions.ts); `publish` validates
against it and refuses unknown keys.

## Prerequisites

- Node 20+ and `pnpm`.
- `seed-cli` with a signing key you can publish under (`seed-cli key` commands; see the
  [seed-cli docs](../../frontend/apps/cli/README.md)) — the extension document is published to that key's space.
- A site where you can test: either your own space, or a site owner willing to install a work-in-progress version.
- Inside the Seed monorepo the SDK is a workspace package (`"@seed-hypermedia/extension-sdk": "workspace:*"`); outside
  it, `pnpm add @seed-hypermedia/extension-sdk`.

## Start from an example

Copy `extensions/examples/hello-signer` (vanilla TypeScript) or `extensions/examples/kanban` (React 18) and rename the
package. The layout every example shares:

```
my-extension/
  seed-extension.json   ← manifest minus `entry`
  README.md             ← becomes the body of the extension document
  index.html            ← <div id="app"></div> + <script type="module" src="/src/main.ts">
  src/main.ts           ← connect(), render
  src/styles.css
  vite.config.ts        ← viteSingleFile(), fixed port, cors: true
  package.json
  tsconfig.json
```

`vite.config.ts`, copied from hello-signer:

```ts
import {defineConfig} from 'vite'
import {viteSingleFile} from 'vite-plugin-singlefile'

export default defineConfig({
  // Inline every script, style and asset into dist/index.html: the host loads
  // the extension through `srcdoc`, where relative URLs cannot resolve.
  plugins: [viteSingleFile()],
  server: {
    // Fixed port so `?extdev=http://localhost:5181` keeps working across restarts.
    port: 5181,
    strictPort: true,
    // The host embeds this dev server in a sandboxed iframe from another
    // (opaque) origin; module scripts are CORS requests, so allow all origins.
    cors: true,
  },
  build: {
    target: 'es2022',
  },
})
```

### Why one self-contained HTML file

The host fetches the entry's bytes and loads them with
`<iframe sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads" srcdoc="…">` — never
`allow-same-origin`. That gives the extension an **opaque origin**, which is what keeps it away from the host's cookies,
storage and DOM, and it has these consequences for your build:

| Constraint                      | Why                                                                            | What to do instead                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| No relative URLs                | `srcdoc` has no base URL; `<script src="./x.js">` and `<img src="a.png">` fail | Inline everything (`vite-plugin-singlefile`); for hypermedia files use `seed.fileUrl(cid)` / `readFile`    |
| No `localStorage`, cookies, IDB | Opaque origins have no storage; the accessors throw                            | `seed.storage.get/set/remove/keys` (per extension, per site, per viewer; needs the `storage` permission)   |
| No same-origin `fetch`          | Requests carry `Origin: null`; the site API refuses them                       | `seed.query(...)`, `seed.getResource(...)`, `seed.readFile(cid)` go through the host                       |
| No `window.top` navigation      | The host ignores `<a target="_top">`                                           | `seed.navigate(url)` / `seed.openExternal(url)` (need `navigate`)                                          |
| Dev server differs              | With `?extdev=` the iframe uses `src=`, so relative URLs _do_ resolve there    | Do not rely on it — run `pnpm build` and check `dist/index.html` has no external references before publish |

`fetch` to third-party endpoints that send CORS headers still works; see [security.md](./security.md) for why that is a
documented non-goal rather than a feature.

## Connect to the host

Everything starts with `connect()`. It sends `hello` every 250 ms until the host answers (the host attaches its listener
a moment after the iframe starts) and rejects with `ExtensionError('not_supported')` after 5 s — which is what happens
when the page is opened outside a Seed host.

```ts
import {applyTheme, connect, injectBaseStyles, type ExtensionContext} from '@seed-hypermedia/extension-sdk'

injectBaseStyles() // --seed-bg, --seed-fg, --seed-accent, … for both themes

const seed = await connect()

seed.onContext((context: ExtensionContext) => {
  applyTheme(context) // <html data-theme="light|dark"> + color-scheme
  console.log('mounted at', context.mountPath, 'as', context.user?.name ?? 'anonymous')
})
```

`onContext` runs the callback immediately and again on every `context` event: sign-in/out, theme change, and route
changes (`subPath` / `query`). `seed.context` always holds the latest value; `seed.user` and
`seed.hasPermission('sign')` are shortcuts into it. The full field list is in
[bridge-api.md](./bridge-api.md#extensioncontext).

In React, keep the context in state (from kanban's `App.tsx`):

```tsx
const [context, setContext] = useState<ExtensionContext>(seed.context)
useEffect(() => seed.onContext(setContext), [seed])
useEffect(() => applyTheme(context), [context.theme])
```

Always handle the rejection of `connect()` — render a short explanation, as every example does:

```ts
connect()
  .then(render)
  .catch((error) => {
    app.textContent = `Could not connect: ${describeError(error)}`
  })
```

## Reading data

Reads need no permission. `seed.query(key, input)` calls the host's universal client with any key in
`EXTENSION_READ_QUERY_KEYS`; the SDK adds typed wrappers for the two most common ones.

**A document by URL** — `getResource` sends a `Resource` query with `{id: 'hm://…'}`; the host unpacks the URL. A `?v=`
in the URL (or the `version` option) pins a version, otherwise you get the latest known one.

```ts
const resource = await seed.getResource(`hm://${seed.context.site.uid}/${seed.context.mountPath}`)
if (resource.type === 'document') {
  const board = resource.document.metadata['kanban']
} else {
  // 'not-found' | 'tombstone' | 'redirect' | 'comment' | 'error'
}
```

**All documents in the space** — the `Query` input takes no ids, just `includes`, `sort` and `limit` (from
site-dashboard):

```ts
const result = (await seed.query('Query', {
  includes: [{space: siteUid, mode: 'AllDescendants'}], // or mode: 'Children' with an optional `path`
  sort: [{term: 'UpdateTime', reverse: true}],
})) as HMQueryResult | null
const docs: HMDocumentInfo[] = result?.results ?? []
```

**Search** — `search(query, opts)` where `opts` is `HMSearchInput` minus `query`:

```ts
const result = await seed.search(query, {accountUid: siteUid, pageSize: 10})
for (const entity of result.entities) console.log(entity.title, entity.id.id)
```

**Activity** — `ListEvents` with a resource glob (`hm://<uid>*` matches the home document and everything beneath):

```ts
const {events} = (await seed.query('ListEvents', {pageSize: 25, filterResource: `hm://${siteUid}*`})) as {
  events: ActivityEvent[]
}
```

**Account names** — `Account` takes a bare uid string:

```ts
const account = (await seed.query('Account', uid)) as
  | {type: 'account'; metadata?: {name?: string}}
  | {type: 'account-not-found'}
```

For keys that nest an id (`ListComments`, `ListDiscussions`, `ListCitations`, `ListChanges`, `ListCapabilities`,
`ListDocumentCollaborators` use `targetId`; `ListCommentsByAuthor` uses `authorId`; `InteractionSummary` uses `id`) pass
`hmRef(url)` in that field:

```ts
import {hmRef} from '@seed-hypermedia/extension-sdk'
const summary = await seed.query('InteractionSummary', {id: hmRef(`hm://${siteUid}/docs`)})
```

Results are converted to plain JSON before crossing the bridge: BigInts become numbers (or strings when too large),
timestamps arrive as `{seconds, nanos}` objects or strings — see `format.ts` in site-dashboard for a tolerant `toDate`.
The inputs for every key are listed in [bridge-api.md](./bridge-api.md#read-query-keys).

## Writing data

All three `sign.*` methods need the `sign` permission and a signed-in viewer, and every call opens a native confirmation
dialog in the host naming your extension, the site, the account and the effect. The promise settles when the viewer
approves (result) or denies (`user_rejected`). The viewer can tick "Allow this extension to sign for the rest of this
session"; that is in memory only.

### Comments

```ts
const targetId = `hm://${seed.context.site.uid}`
const {commentId} = await seed.sign.comment({targetId, markdown: 'Hello from the **Hello Signer** extension!'})
```

`markdown` is converted to blocks by the host; pass `blocks` (`HMBlockNode[]`) instead for full control. `targetVersion`
defaults to the latest known version of the target; `replyCommentVersion` / `rootReplyCommentVersion` make it a reply.

### Documents

`sign.document` creates the document if it does not exist and otherwise publishes a change on top of the latest version.
It is a **merge**, not a replace:

- `metadata` — only the keys you pass are touched. Existing keys you do not mention are left alone. A value of `null`
  deletes the key (object-valued keys are deleted leaf by leaf). Values must be strings, booleans, integers or nested
  objects of those; the host publishes them as document attributes.
  <!-- TODO(verify): non-integer numbers are silently dropped and arrays are flattened into numeric-keyed objects by the attribute encoder (shared/utils/document-changes.ts); confirm how arrays read back before recommending them. -->
- `blocks` — replaces the whole body with the given `HMBlockNode[]`. Omit it to leave the content untouched. Blocks keep
  their ids when you supply them, so an extension that round-trips the existing content edits in place; missing or
  duplicate ids are regenerated.
- `summary` — the sentence shown in the confirmation dialog.

Kanban keeps its whole board under one metadata key on the document at its mount path:

```ts
const boardId = `hm://${context.site.uid}/${context.mountPath}`

await seed.sign.document({
  id: boardId,
  metadata: {name: docName, kanban: board},
  summary: savedJson === null ? 'Create the kanban board document' : 'Update the kanban board',
})
```

Because every save is a signed change, the board's history is the document's version history. The document at the mount
path is a good place for state precisely because the mount shadows it in the page UI (see Navigation below).

If the viewer is not the space owner, the host looks up a write capability for them; without one the call fails with
`permission_denied` before anything is published.

### Arbitrary data

```ts
const {signature, signer, accountId} = await seed.sign.data(text, 'Demonstrate signing from the Hello Signer extension')
```

`data` is bytes or a UTF-8 string; `purpose` is shown in the dialog. The host does **not** sign your bytes directly. It
signs

```
"seed-extension-signature:v1\n" + extensionId + "\n" + bytes
```

(`buildSignDataPayload(extensionId, bytes)`), so a signature obtained through an extension can never be replayed as a
Seed protocol blob, and a signature obtained through one extension cannot be presented as coming from another.

To verify one, reconstruct the payload and check the Ed25519 signature against the `signer` principal. A principal is a
base58btc multibase string of `0xed 0x01` + the 32-byte public key:

```ts
import {buildSignDataPayload} from '@seed-hypermedia/extension-sdk'
import {principalFromString, ED25519_VARINT_PREFIX} from '@seed-hypermedia/client/blobs'
import {ed25519} from '@noble/curves/ed25519'

const payload = buildSignDataPayload(extensionId, bytes) // extensionId = context.extensionId, e.g. hm://z6Mk…/kanban
const publicKey = principalFromString(signer).slice(ED25519_VARINT_PREFIX.length)
const ok = ed25519.verify(signature, payload, publicKey)
```

Note the two identities in the result: `signer` is the key that produced the signature and `accountId` is the account it
acts for. On the web app the signer is usually a **delegated device key** holding a vault delegation, so
`signer !== accountId` is normal. The result carries no proof of that delegation; if you need to bind a signature to the
account rather than to the device key, look up the delegation (capability) on the network before trusting `accountId`.

## Navigation and routing

Needs the `navigate` permission except for `setRoute`.

```ts
await seed.navigate(`hm://${seed.context.site.uid}`) // hm:// URL …
await seed.navigate('/docs/roadmap') // … or a site-relative path
await seed.openExternal('https://hyper.media') // new tab / system browser; http(s) only
```

`navigate` accepts `hm://` URLs and paths starting with `/`; anything else is `invalid_params`. Pass `{replace: true}`
to replace the history entry.

For routing **inside** your extension use the sub-path. A mount at `board` receives `/board/card/abc` as
`context.mountPath = 'board'`, `context.subPath = ['card', 'abc']`, plus `context.query` from the query string.
`setRoute` changes the URL beneath the mount without leaving the page; the new `subPath`/`query` come back through
`onContext`:

```ts
await seed.setRoute(['card', card.id], {tab: 'notes'})
```

The mount **shadows** the document at that path and everything beneath it: readers get your extension, not the document
page. The document still exists and is reachable through the API, which is why kanban stores its state there.

## Storage

`seed.storage` is a string key/value store kept by the host in the viewer's browser, namespaced per extension and per
site (`seed.ext.<extensionId>.<siteUid>.<key>` in the host's `localStorage`). Needs the `storage` permission. It is a
convenience for per-viewer preferences — it does not sync, and the viewer can clear it. Kanban remembers its auto-save
toggle with it:

```ts
const value = await seed.storage.get('autosave') // string | null
await seed.storage.set('autosave', enabled ? '1' : '0')
await seed.storage.remove('autosave')
const keys = await seed.storage.keys()
```

Guard with `seed.hasPermission('storage')` when the feature is optional.

## Errors

Every failed bridge call rejects with an `ExtensionError` whose `code` tells you what to do. `describeError` in the
examples' `errors.ts` is a reasonable default mapping:

| Code                | Meaning                                                                                        | What to do                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `user_rejected`     | The viewer pressed Deny or closed the confirmation dialog                                      | Nothing was published; keep local state and let them retry                                     |
| `not_signed_in`     | A `sign.*` call with no signed-in viewer                                                       | Show a "sign in first" hint; watch `context.user` via `onContext` and re-enable the action     |
| `permission_denied` | The manifest lacks the permission the method needs, or the account has no write capability     | Add the permission to `seed-extension.json` and republish; or tell the viewer they cannot edit |
| `invalid_params`    | Params failed validation, an id is not a valid `hm://` URL, or the query input was rejected    | A bug in the extension — fix the call; the message names the field                             |
| `not_supported`     | No host answered `connect()`; a method the host lacks; storage unavailable; document redirects | Degrade the feature; for redirects the target is in `error.data.redirectTarget`                |
| `unknown_method`    | The method name is not in the protocol                                                         | Wrong SDK/host version pairing; check `context.protocol`                                       |
| `internal`          | Unexpected host failure (network, daemon), or the SDK was disconnected                         | Show the message and offer retry                                                               |

```ts
import {ExtensionError} from '@seed-hypermedia/extension-sdk'

export function describeError(error: unknown): string {
  if (error instanceof ExtensionError) {
    switch (error.code) {
      case 'user_rejected':
        return 'You cancelled the request in the confirmation dialog.'
      case 'not_signed_in':
        return 'Sign in to the site first, then try again.'
      case 'permission_denied':
        return `This extension is not allowed to do that (${error.message}).`
      case 'not_supported':
        return `Not supported here: ${error.message}`
      default:
        return `${error.code}: ${error.message}`
    }
  }
  return error instanceof Error ? error.message : String(error)
}
```

## Developing with hot reload

1. `pnpm dev` in your extension directory. The port must be fixed (`strictPort: true`) and `server.cors` must be on.
2. Install the extension on a site you control (a placeholder publish is fine — the code is replaced by the override),
   or ask the site owner to.
3. Point the host at your dev server:
   - **Web:** open the extension's page and append `?extdev=http://localhost:5181`. The host writes the override into
     `localStorage['seed.extensions.devOverrides'][extensionId]`, strips the parameter from the URL and reloads the
     frame from your dev server. `?extdev=off` clears it.
   - **Desktop:** Settings → Advanced → DEVELOPERS → **Extension dev overrides** → Edit overrides. Add a row with the
     extension id (`hm://<author>/<path>`, no version) and the dev URL.
4. A yellow **Dev override: http://localhost:5181** banner sits above the frame while an override is active; click it to
   clear the override. `context.dev` is `true` in the extension.

The override still runs inside the same sandbox and speaks the same protocol, so what you see is what ships — except
that relative URLs resolve under `src=` and not under `srcdoc` (see the constraints table). Build before publishing.

## Publishing and versioning

```sh
pnpm build                                  # → dist/index.html
seed-cli extension publish . --key mykey -p my-ext --dry-run   # validate, show what would be published
seed-cli extension publish . --key mykey -p my-ext
```

`publish` reads `seed-extension.json`, uploads `dist/index.html` to IPFS, fills in `entry`, writes the manifest into the
document's metadata and the README into its body, and prints the `hm://` URL. Republishing to the same `-p` path updates
the document in place. Full options in [cli.md](./cli.md).

Versioning works on two levels:

- `version` in the manifest is **informational** semver for humans (install UIs show `v0.1.0`). Bump it when you publish
  — it is how a site owner tells releases apart.
- The extension **document version** (a CID) is the identity the network uses. Installs pin it by default, so publishing
  never changes what an installed site runs until its owner explicitly updates. Sites installed with `--latest` follow
  every publish.
- If you start using a bridge feature that only newer hosts have, set `minProtocol` in the manifest; older hosts then
  show "Extension needs a newer app" instead of failing at runtime.

## Getting installed

Send the site owner the extension's `hm://<yourUid>/<path>` URL. They install it from the desktop app (Site settings →
Extensions → Install an extension, paste the URL, review permissions, choose the mount path) or with
`seed-cli extension install <url> --path <mount> --key <sitekey>`. That writes a signed install record into their site's
home document, keyed by the mount path, and your extension is live at `https://<site>/<mount>`. The
[site owner guide](./site-owner-guide.md) describes their side, including how they update to a new version you publish.

## Checklist before publishing

- [ ] `pnpm build` succeeds and `dist/index.html` contains no `src="./…"`, `href="./…"` or other relative references.
- [ ] `seed-extension.json` requests only the permissions you use (`sign`, `navigate`, `storage`); the install UI shows
      them to site owners.
- [ ] `description` is one sentence; `README.md` explains what the extension does with the data and what it signs.
- [ ] `version` bumped since the last publish.
- [ ] `connect()` rejection is handled (opening the built file directly shows a message, not a blank page).
- [ ] Every `sign.*` call handles `user_rejected` and `not_signed_in`; signed-out viewers can still use the read-only
      parts.
- [ ] Light and dark themes look right (`applyTheme` + `--seed-*` variables, or your own `[data-theme="dark"]` rules).
- [ ] Tested through `?extdev=` on the real host, on both web and desktop if you can.
- [ ] `seed-cli extension publish --dry-run` passes.
