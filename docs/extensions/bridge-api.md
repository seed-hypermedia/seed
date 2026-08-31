# Bridge API reference

Every method, event, error and message shape of the host ⇄ extension bridge, protocol version **1**. The normative
definitions are the TypeScript types in
[`frontend/packages/client/src/extensions.ts`](../../frontend/packages/client/src/extensions.ts) (`ExtensionMethods`,
`ExtensionEvents`, `ExtensionContext`, `EXTENSION_METHOD_PERMISSIONS`); the host validates params with the zod schemas
in
[`frontend/packages/ui/src/extensions/bridge-schemas.ts`](../../frontend/packages/ui/src/extensions/bridge-schemas.ts)
and implements each method in `host-handlers.ts` beside it. The SDK wrappers are in
[`frontend/packages/extension-sdk/src/connect.ts`](../../frontend/packages/extension-sdk/src/connect.ts).

Conventions used below: "Permission" is the entry in `EXTENSION_METHOD_PERMISSIONS` (— means always allowed); "Errors"
lists codes specific to the method on top of the ones every method can return (`invalid_params` for params that fail
validation, `permission_denied` when the permission is missing, `not_supported` when the host has no handler, `internal`
for anything unexpected). All params and results are JSON; binary data travels as standard base64.

## Methods

### `hello`

| Permission | —                                                                               |
| ---------- | ------------------------------------------------------------------------------- |
| Params     | `{protocol: number, sdkVersion?: string}`                                       |
| Result     | [`ExtensionContext`](#extensioncontext)                                         |
| SDK        | sent by `connect()`; the SDK re-sends it every `helloIntervalMs` until answered |

The handshake. The SDK sends its `EXTENSION_PROTOCOL_VERSION`; the host answers with the full context. Stray duplicate
answers to a retried `hello` are dropped by the SDK.

### `getContext`

| Permission | —                                       |
| ---------- | --------------------------------------- |
| Params     | `{}`                                    |
| Result     | `ExtensionContext`                      |
| SDK        | `seed.context` (kept current by events) |

Re-fetch the context. Rarely needed: the host pushes a `context` event on every change.

### `api.query`

| Permission | —                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------- |
| Params     | `{key: ExtensionReadQueryKey, input: unknown}`                                            |
| Result     | the query's output, converted to plain JSON                                               |
| Errors     | `invalid_params` — unknown key, bad `hm://` id, or the universal client rejected `input`  |
| SDK        | `seed.query(key, input)`, `seed.getResource(id, {version?})`, `seed.search(query, opts?)` |

Read-only access to the host's universal client `request(key, input)`. Only the keys in
[`EXTENSION_READ_QUERY_KEYS`](#read-query-keys) are accepted; `hm://` strings in id fields are unpacked per the
[id-unpacking rule](#id-unpacking-rule). Results pass through `toCloneable`: BigInt → number (string when outside the
safe range), `Map` → object, `Set` → array, `undefined`/functions dropped.

```ts
const home = await seed.getResource(`hm://${seed.context.site.uid}`)
const docs = await seed.query('Query', {includes: [{space: seed.context.site.uid, mode: 'AllDescendants'}]})
```

### `file.url`

| Permission | —                                    |
| ---------- | ------------------------------------ |
| Params     | `{cid: string}`                      |
| Result     | `{url: string}`                      |
| SDK        | `seed.fileUrl(cid): Promise<string>` |

A URL the iframe can load the IPFS file from — web: absolute `/hm/api/file/<cid>` on the site origin (served with
permissive CORS); desktop: the daemon's `/ipfs/<cid>` URL. Works in `<img src>`, `<video>`, and `fetch` where CORS
allows.

```ts
img.src = await seed.fileUrl(block.link.slice('ipfs://'.length))
```

### `file.read`

| Permission | —                                                       |
| ---------- | ------------------------------------------------------- |
| Params     | `{cid: string, maxBytes?: number}` (default cap 10 MiB) |
| Result     | `{base64: string, contentType?: string}`                |
| SDK        | `seed.readFile(cid, {maxBytes?}): Promise<Uint8Array>`  |

The file's bytes through the host, for when the iframe cannot fetch the URL itself.

```ts
const bytes = await seed.readFile(cid, {maxBytes: 1_000_000})
const text = new TextDecoder().decode(bytes)
```

### `sign.comment`

| Permission | `sign`                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Params     | `{targetId: string, targetVersion?: string, markdown?: string, blocks?: HMBlockNode[], replyCommentVersion?: string, rootReplyCommentVersion?: string}` — `markdown` or `blocks` required |
| Result     | `{commentId: string}`                                                                                                                                                                     |
| Errors     | `not_signed_in`, `user_rejected`, `invalid_params` (target is not a document, empty body, invalid blocks)                                                                                 |
| SDK        | `seed.sign.comment(params)`                                                                                                                                                               |

Publishes a comment on `targetId` as the viewer after a confirmation dialog showing the target, a text preview and
whether it is a reply. `targetVersion` defaults to the version in the `targetId` URL, then to the latest known version.
`markdown` is parsed by the host. When `replyCommentVersion` is given without `rootReplyCommentVersion`, the host
fetches the parent comment and uses its thread root (the parent itself when the parent is a root), so replies to replies
join the existing discussion.

```ts
const {commentId} = await seed.sign.comment({targetId: `hm://${siteUid}/notes`, markdown: 'Looks good.'})
```

### `sign.document`

| Permission | `sign`                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Params     | `{id: string, metadata?: Record<string, unknown>, blocks?: HMBlockNode[], summary?: string}` — `metadata` or `blocks` required                                                                                                         |
| Result     | `{id: string, version: string}` — `version` is the CID of the signed Change (the new document version), or the current version when nothing changed                                                                                    |
| Errors     | `not_signed_in`, `user_rejected`, `permission_denied` (no write capability on the space), `invalid_params` (id is a comment; the document does not exist and nothing was given), `not_supported` (id redirects; `data.redirectTarget`) |
| SDK        | `seed.sign.document(params)`                                                                                                                                                                                                           |

Creates `id` if it does not exist, otherwise publishes a change on the latest version. The host builds the Change
client-side, signs a Version Ref and publishes the blobs. `metadata` is merged key by key (`null` deletes; unmentioned
keys untouched; values may be strings, numbers, booleans, arrays stored whole, or nested objects — an empty object
writes nothing); `blocks` replaces the whole body (block ids are kept when supplied, generated otherwise). The dialog
shows the document, whether it exists, `summary`, each metadata key's before/after and the block count of a body
replace. When the viewer is not the space owner the host resolves a write capability first. When the requested metadata
and blocks equal the published document, the call resolves with `{id, version: <current version>}` without a dialog and
without publishing; `invalid_params` "nothing to change" is raised only when the document does not exist. A change that
touches the `extensions` or `seedExtension` metadata keys is always confirmed, even with a session grant.

```ts
await seed.sign.document({
  id: `hm://${siteUid}/${mountPath}`,
  metadata: {name: 'Board', kanban: board, draft: null},
  summary: 'Update the kanban board',
})
```

### `sign.data`

| Permission | `sign`                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Params     | `{base64: string, purpose: string}`                                                                        |
| Result     | `{signature: string (base64), signer: string, accountId: string}`                                          |
| Errors     | `not_signed_in`, `user_rejected`, `invalid_params` (bad base64)                                            |
| SDK        | `seed.sign.data(data: Uint8Array \| string, purpose): Promise<{signature: Uint8Array, signer, accountId}>` |

Signs `buildSignDataPayload(extensionId, bytes)` = `"seed-extension-signature:v1\n" + extensionId + "\n" + bytes` with
the viewer's signer. The dialog shows `purpose`, the byte length and a hex preview. `signer` is the principal of the key
that signed — on the web usually a delegated device key, so it can differ from `accountId`. Verification is described in
the [developer guide](./developer-guide.md#arbitrary-data).

```ts
const {signature, signer} = await seed.sign.data('hello', 'Prove you are the viewer')
```

#### Confirmation dialog (all `sign.*` methods)

The host opens one dialog at a time, naming the extension, the site, the account and the effect. When a dev override is
active the dialog shows a warning with the override URL. **Approve** is inert for ~500 ms after the dialog opens. "Allow
this extension to sign for the rest of this session" skips the dialog for later calls; the grant is in-memory, keyed on
`(extension, site, account, code source)`, and never covers a `sign.document` that writes `extensions` or
`seedExtension`.

### `navigate`

| Permission | `navigate`                                                        |
| ---------- | ----------------------------------------------------------------- |
| Params     | `{url: string, replace?: boolean}`                                |
| Result     | `null`                                                            |
| Errors     | `invalid_params` — not an `hm://` URL or a path starting with `/` |
| SDK        | `seed.navigate(url, {replace?})`                                  |

Navigates the host app: `hm://` URLs open the corresponding route, `/path` navigates within the current site.

```ts
await seed.navigate(doc.id.id)
```

### `openExternal`

| Permission | `navigate`                              |
| ---------- | --------------------------------------- |
| Params     | `{url: string}`                         |
| Result     | `null`                                  |
| Errors     | `invalid_params` — not an `http(s)` URL |
| SDK        | `seed.openExternal(url)`                |

New tab (web) or the system browser (desktop).

### `route.set`

| Permission | —                                                                        |
| ---------- | ------------------------------------------------------------------------ |
| Params     | `{subPath: string[], query?: Record<string, string>, replace?: boolean}` |
| Result     | `null`                                                                   |
| SDK        | `seed.setRoute(subPath, query?, {replace?})`                             |

Updates the URL beneath the mount without a host navigation. The host then pushes a `context` event with the new
`subPath` and `query`.

```ts
await seed.setRoute(['card', id], {tab: 'notes'})
```

### `storage.get` / `storage.set` / `storage.remove` / `storage.keys`

| Permission | `storage`                                                                        |
| ---------- | -------------------------------------------------------------------------------- |
| Params     | `{key}` · `{key, value: string}` · `{key}` · `{}`                                |
| Result     | `{value: string \| null}` · `null` · `null` · `{keys: string[]}`                 |
| Errors     | `not_supported` (no storage in this host), `internal` (write failed, e.g. quota) |
| SDK        | `seed.storage.get(key)`, `.set(key, value)`, `.remove(key)`, `.keys()`           |

String key/value store in the viewer's browser, namespaced `seed.ext.<extensionId>.<siteUid>.<key>`. `keys()` returns
the un-prefixed keys of this extension on this site.

### `ui.toast`

| Permission | —                                                          |
| ---------- | ---------------------------------------------------------- |
| Params     | `{message: string, kind?: 'info' \| 'success' \| 'error'}` |
| Result     | `null`                                                     |
| SDK        | `seed.toast(message, kind?)`                               |

### `ui.setTitle`

| Permission | —                      |
| ---------- | ---------------------- |
| Params     | `{title: string}`      |
| Result     | `null`                 |
| SDK        | `seed.setTitle(title)` |

Sets the host page/window title.

### `ui.resize`

| Permission | —                        |
| ---------- | ------------------------ |
| Params     | `{height: number}` (≥ 0) |
| Result     | `null`                   |
| SDK        | `seed.resize(height)`    |

Asks the host to size the frame to `height` CSS pixels. Page extensions fill the available height and the host ignores
this; it exists for embedded kinds (custom blocks) on the roadmap.

## `ExtensionContext`

Sent as the `hello` result and again, whole, in every `context` event.

| Field              | Type                                         | Meaning                                                                                                                          |
| ------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `protocol`         | `number`                                     | Bridge protocol the host speaks (`EXTENSION_PROTOCOL_VERSION`, currently 1)                                                      |
| `platform`         | `'web' \| 'desktop' \| 'mobile'`             | Host kind                                                                                                                        |
| `extensionId`      | `string`                                     | `hm://` id of the extension document, without version; the id used in `sign.data` payloads, storage namespaces and dev overrides |
| `extensionVersion` | `string \| null`                             | Document version actually loaded (pinned or latest)                                                                              |
| `manifest`         | `ExtensionManifest`                          | The parsed manifest of that version                                                                                              |
| `site.uid`         | `string`                                     | Space the extension is installed on                                                                                              |
| `site.name`        | `string?`                                    | Site home document name                                                                                                          |
| `site.origin`      | `string?`                                    | Public origin of the site when known (web)                                                                                       |
| `mountPath`        | `string`                                     | Where it is mounted, e.g. `board`                                                                                                |
| `subPath`          | `string[]`                                   | Segments after the mount, e.g. `['card', 'abc']` for `/board/card/abc`                                                           |
| `query`            | `Record<string, string>`                     | Query string of the current URL                                                                                                  |
| `settings`         | `Record<string, unknown>`                    | `settings` from the install record                                                                                               |
| `user`             | `{accountId: string, name?: string} \| null` | Signed-in viewer, or null                                                                                                        |
| `theme`            | `'light' \| 'dark'`                          | Host theme                                                                                                                       |
| `permissions`      | `ExtensionPermission[]`                      | Permissions actually granted (intersection of manifest and host policy)                                                          |
| `dev`              | `boolean`                                    | True when loaded from a developer override instead of the published entry                                                        |

## Events

| Event     | Data               | When                                                                                                |
| --------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `context` | `ExtensionContext` | User signed in/out, theme changed, route changed (`route.set` or host navigation), settings changed |

The SDK folds events into `seed.context` and calls every `onContext` listener.

## Error codes

Wire shape: `{code, message, data?}`. The SDK rethrows them as `ExtensionError` with the same fields.

| Code                | Raised when                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `permission_denied` | Method needs a permission the manifest does not grant (`data.permission`); or the viewer has no write capability for `sign.document` |
| `user_rejected`     | The viewer denied or closed the confirmation dialog                                                                                  |
| `not_signed_in`     | A `sign.*` method with `context.user === null`                                                                                       |
| `unknown_method`    | `method` is not in `ExtensionMethods`                                                                                                |
| `invalid_params`    | Params fail the method's zod schema, an id is not a valid `hm://` URL, or the underlying query rejected the input                    |
| `not_supported`     | No host answered `hello`; the host has no handler for the method; storage unavailable; document redirects                            |
| `internal`          | Unexpected failure in the host (message only, no stack); or the SDK was disconnected while a call was pending                        |

## Wire format

Every message carries the tag `"seed-extension": 1` (tag name `EXTENSION_MESSAGE_TAG`, value
`EXTENSION_PROTOCOL_VERSION`) and a `type`. Untagged traffic is ignored by both sides.

Request (iframe → host, `window.parent.postMessage(msg, '*')`):

```json
{"seed-extension": 1, "type": "request", "id": 7, "method": "storage.set", "params": {"key": "counter", "value": "3"}}
```

Response (host → iframe, `iframe.contentWindow.postMessage(msg, '*')`), exactly one per request id:

```json
{"seed-extension": 1, "type": "response", "id": 7, "result": null}
```

```json
{
  "seed-extension": 1,
  "type": "response",
  "id": 8,
  "error": {
    "code": "permission_denied",
    "message": "Method navigate requires the \"navigate\" permission, which this extension does not have",
    "data": {"permission": "navigate"}
  }
}
```

Event (host → iframe):

```json
{"seed-extension": 1, "type": "event", "event": "context", "data": {"protocol": 1, "platform": "web", "…": "…"}}
```

Rules:

- `id` is a positive integer allocated by the SDK; responses to unknown ids are dropped.
- `result` is never `undefined` on the wire — the host sends `null`.
- `'*'` is the target origin in both directions because the sandboxed frame has an opaque origin. Trust comes from the
  source check instead: the host only handles messages whose `event.source === iframe.contentWindow`; the SDK only
  handles messages whose `event.source === window.parent`.
- Requests only flow iframe → host; the SDK ignores any `request` it receives.

## Handshake sequence

```
extension                                  host
   │  request hello {protocol: 1, sdkVersion}  │   (repeated every 250 ms)
   │ ─────────────────────────────────────────▶│
   │                                           │  host listener attached; validates params,
   │                                           │  answers with getContext()
   │  response {id, result: ExtensionContext}  │
   │ ◀─────────────────────────────────────────│
   │  connect() resolves; later:               │
   │  event context {…}                        │  on user / theme / route / settings change
   │ ◀─────────────────────────────────────────│
```

If no response arrives within `timeoutMs` (default 5000) `connect()` rejects with `not_supported`. The host does not
check `minProtocol` here — it checks the manifest before mounting the frame and shows "Extension needs a newer app"
instead of loading it.

## Id-unpacking rule

The host's query API takes `UnpackedHypermediaId` objects; the SDK does not carry the URL parser, so it sends **packed
strings** and the host unpacks them (`normalizeHmIdInput` in `host-utils.ts`). Accepted forms in an id position:

- an `hm://` string — `'hm://z6Mk…/docs?v=bafy…'`;
- `{id: 'hm://…'}` (what `hmRef(url, version?)` builds);
- an already-unpacked object with `uid` (`path`, `version`, `latest`, `blockRef` optional).

A `v` query parameter pins the document version; without it the id resolves to the latest known version. Anything else
is `invalid_params`. The fields unpacked per key:

| Key                                                                                                                                           | Field           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `Resource`, `ResourceMetadata`                                                                                                                | the whole input |
| `ListComments`, `ListDiscussions`, `ListCommentsByReference`, `ListCitations`, `ListChanges`, `ListCapabilities`, `ListDocumentCollaborators` | `targetId`      |
| `ListCommentsByAuthor`                                                                                                                        | `authorId`      |
| `InteractionSummary`                                                                                                                          | `id`            |

Other keys are passed through untouched.

## Read query keys

`EXTENSION_READ_QUERY_KEYS`, with the purpose and the input shape (from the `HM*InputSchema`s in
[`frontend/packages/client/src/hm-types.ts`](../../frontend/packages/client/src/hm-types.ts) and the implementations in
`frontend/packages/shared/src/api-*.ts`). Ids marked _hm id_ accept the forms above.

| Key                         | Purpose                                                                                        | Input                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Resource`                  | A document, comment, redirect or tombstone by id → `HMResource`                                | _hm id_                                                                                                                                                                                                 |
| `ResourceMetadata`          | Just the metadata of a resource (cheaper than `Resource`)                                      | _hm id_                                                                                                                                                                                                 |
| `Account`                   | An account's profile metadata → `{type: 'account', metadata}` or `{type: 'account-not-found'}` | `string` (account uid)                                                                                                                                                                                  |
| `AccountContacts`           | Contact records published by an account                                                        | `string` (account uid)                                                                                                                                                                                  |
| `SubjectContacts`           | Contact records naming an account as their subject                                             | `string` (subject uid)                                                                                                                                                                                  |
| `Comment`                   | One comment → `HMComment`                                                                      | `string` (comment id)                                                                                                                                                                                   |
| `Search`                    | Full-text search → `HMSearchPayload` (`entities[]`)                                            | `{query, accountUid?, includeBody?, contextSize?, perspectiveAccountUid?, searchType?, pageSize?, pageToken?, iriFilter?, contentTypeFilter?, entityKindFilter?}`                                       |
| `Query`                     | List documents in a space/folder → `HMQueryResult \| null` (`results[]`)                       | `{includes: [{space, path?, mode: 'Children' \| 'AllDescendants'}], sort?: [{term: 'Path' \| 'Title' \| 'CreateTime' \| 'UpdateTime' \| 'DisplayTime' \| 'ActivityTime', reverse?}], limit?}`           |
| `QueryBlock`                | The same query as rendered by a query block, with per-item summaries                           | `{query: <Query input>}`                                                                                                                                                                                |
| `ListComments`              | All comments on a document → `{comments, authors}`                                             | `{targetId: hm id}`                                                                                                                                                                                     |
| `ListDiscussions`           | Comments grouped into discussion threads, optionally one thread                                | `{targetId: hm id, commentId?}`                                                                                                                                                                         |
| `ListCommentsByReference`   | Comments whose target is the given resource (incl. citations)                                  | `{targetId: hm id}`                                                                                                                                                                                     |
| `ListCommentsByAuthor`      | Comments written by an account → `{comments, authors}`                                         | `{authorId: hm id}`                                                                                                                                                                                     |
| `ListCommentVersions`       | Edit history of a comment → `{versions}`                                                       | `{id: string}` (comment id)                                                                                                                                                                             |
| `GetCommentReplyCount`      | Number of replies to a comment                                                                 | `{id: string}` (comment id)                                                                                                                                                                             |
| `ListEvents`                | Activity feed (document updates, comments, citations, …) → `{events, nextPageToken}`           | `{pageSize?, pageToken?, trustedOnly?, filterAuthors?: string[], filterEventType?: string[], filterResource?: string (IRI glob, e.g. 'hm://<uid>*'), currentAccount?, order?: 'claimed' \| 'observed'}` |
| `ListCitations`             | Resources that cite (link to) the target                                                       | `{targetId: hm id}`                                                                                                                                                                                     |
| `ListChanges`               | Version history of a document (change ids, authors, deps)                                      | `{targetId: hm id}`                                                                                                                                                                                     |
| `ListCapabilities`          | Access-control capabilities granted on the target                                              | `{targetId: hm id}`                                                                                                                                                                                     |
| `ListDocumentCollaborators` | Who may write to the document, resolved from capabilities → `{publisherUid, …}`                | `{targetId: hm id}`                                                                                                                                                                                     |
| `InteractionSummary`        | Comment / citation / change counts for a document                                              | `{id: hm id}`                                                                                                                                                                                           |
| `GetCID`                    | Decode a raw blob by CID → `{value}`                                                           | `{cid: string}`                                                                                                                                                                                         |

Write keys (`PublishBlobs`, `PrepareDocumentChange`) are not reachable through `api.query`; writes go through `sign.*`.

## Protocol versioning

- `EXTENSION_PROTOCOL_VERSION` (currently `1`) is stamped on every message as the value of the `seed-extension` tag and
  reported in `hello` and `context.protocol`. It is bumped only when the wire format changes incompatibly; adding
  methods, optional params or context fields does not bump it.
- A manifest may set `minProtocol`. The host compares it with its own version before mounting the frame and shows
  "Extension needs a newer app" when the host is too old. Omit it unless you depend on something introduced after
  protocol 1.
- Hosts accept any `hello.protocol`; an SDK newer than the host will get `unknown_method` for methods the host lacks,
  and should fall back or check `context.protocol`.
