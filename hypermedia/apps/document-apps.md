---
name: Document apps
summary: A document whose `app` attribute names a UnixFS folder with an index.html opens as that app, sandboxed, and reads, writes and signs Hypermedia as the viewer through a host-owned bridge after an app-session grant.
---
A **document app** is a [document](../protocol/documents.md) that carries a web app. Its [metadata](../metadata.md) has an `app` attribute, an `ipfs://<cid>` that names a UnixFS folder whose `index.html` is a self-contained app (its own scripts, styles and images beside it, by relative path). When the document is opened in Seed, the app is shown in place of the document body. The folder is a file the document references, so it syncs with the document: share the document and the app arrives with it. <!-- id:4p_wlxmi -->

An agent builds such an app with the ordinary [`write` verb](../agent.md): it writes the HTML under its memory and then writes a document with `options.app` naming that folder (or single HTML file). The folder is published to IPFS as a UnixFS directory in the same publish as the document change, and the document's `app` attribute points at it. The write result carries a `seed-app` fence that shows the app running inside the chat, and the document's `hm://` URL is what people share. There is no separate app tool and no app that is not a document. <!-- id:s4mOJM7z -->

# What the app may do <!-- id:sEBfqfoQ -->

The app is untrusted code: once a document is shared, someone else's app runs on the viewer's machine beside the viewer's data. So the app runs in an origin of its own, with no network, no access to the daemon or its secret, and no access to the Seed window. Desktop permits assets from the app folder. Web uses an opaque iframe and HTTP CSP sandbox on the same Seed origin; inline scripts/styles and embedded images are supported. Use self-contained HTML for both platforms. Sandboxing does not guarantee that data disclosed to app code cannot leave it through navigation. <!-- id:MyRnFAuR -->
  - **Origin.** The desktop serves the folder at `seed-app://<host>/`, where the host is a digest of the document id. The origin belongs to the document, not to one revision, so legacy native `localStorage` is per document, but not per viewer. Portable apps must use `seed.storage.get/set`, whose host-managed namespace is `(viewer account, canonical document HMID)`, independent of the app revision. Different resources never share that state, even if their HTML is identical. <!-- id:qkgetBC6 -->
  - **Bridge.** The app includes `<script src="/.seed/client.js"></script>`, which defines `window.seed`. Each method posts a request to the Seed window that embeds the app and resolves with its answer; the Seed window answers the allowed calls. Web installs the API before app code runs and ignores the desktop bridge include. Both platforms allow the app document and selected viewer profile before approval; broader account access requires a Seed-owned trust prompt. <!-- id:Q1Xrhos_ -->
  - **SDK.** `seed.context()` returns `{protocol: 1, document, version, account, app}`; `account` is the selected viewer UID or null, not `viewer`. `seed.profile()` returns `{id, name}` for that viewer or null when signed out. Use `const profile = await seed.profile(); heading.textContent = profile?.name ? "Hello, " + profile.name + "!" : "Hello, friend!"`. Profile data comes from the Account API, not a document at `/:profile`; that URL is supported as a compatibility alias for the selected viewer. Handle SDK errors separately from signed-out state. `seed.resource(hmUrl)` reads the app document before approval, and other resources after approval. `seed.directory(hmUrl, {all})` also requires approval on both platforms. `seed.storage.get(key)` returns saved JSON or null; `seed.storage.set(key, value)` persists JSON (64 keys, 128 characters/key, 16 KiB/value). Full reads, writes and signatures require the session grant described below. <!-- id:W8d7Tl95 -->

# Account access, writes and signatures <!-- id:YSnzkVRV -->

Mini apps use a host-owned facade over `@seed-hypermedia/client`, on both desktop and web: <!-- id:LB_GsYHp -->

```js <!-- id:4euGDfTy -->
await seed.permissions.request() // Seed asks once for full account access
const content = await seed.hm.parseMarkdown(messageInput.value)
const {commentId, version} = await seed.comments.create({content})
```

`seed.hm.parseMarkdown` returns HM block nodes with IDs and annotations. `seed.hm.validateContent(content)` validates app-constructed block nodes. Both are asynchronous, use the existing SDK in the host, and have no signing side effects. `seed.hm.unpackHmId(url)` parses HM URLs. Requests are limited to 8 MiB including binary bytes, with at most 32 pending calls. <!-- id:FtuStJku -->

`seed.permissions.request()` opens a Seed-owned full-account trust prompt. The first privileged call also triggers it automatically. Approval is shared by subsequent calls for this open instance, selected viewer, canonical document and code revision. Seed shows a Revoke access control outside the app. `seed.permissions.revoke()`, account/revision changes and app closure end the grant. Declining causes the operation to reject without signing or publishing. <!-- id:__iSnD5h -->

This is full account authority: the app may read accessible content, create/edit/delete documents and comments, grant capabilities and sign arbitrary bytes. Keys remain in Seed. The opaque web sandbox still blocks parent DOM, cookies, native storage and direct network calls. Account trust deliberately grants broad data and signing access through the broker; sandboxing is not a promise that disclosed data cannot leave the app. Revocation prevents subsequent operations and delivery of late results, but cannot recall signatures, publications or permissions already issued. <!-- id:ICIxoM5i -->

The asynchronous APIs are identical on web and desktop: <!-- id:-PeUsTvd -->
  - `seed.request(key, input)` exposes all requests in the SDK's `HMRequest` union with schema-validated inputs. `seed.resource(url)` and `seed.directory(url, {all})` are convenience reads. <!-- id:JEL8XDJg -->
  - `seed.publish({blobs: [{cid, data}]})` publishes arbitrary blobs; `data` is a `Uint8Array`. `seed.publishDocument({account, path, changes, baseVersion?, genesis?, generation?, capability?, visibility?})` prepares, signs and publishes protobuf document operations. `account` is the target space; signing always uses the selected viewer. <!-- id:Gy79meik -->
  - `seed.signer.getPublicKey()` and `seed.signer.sign(bytes)` implement `HMSigner`, for an SDK bundled inline into the app. The app receives public-key/signature bytes, never private keys. Web sign-in may use a delegated device key whose signing principal differs from the selected account; the protocol still enforces its delegation. <!-- id:hI7cG6fU -->
  - `seed.hm` provides the SDK's `createComment`, `updateComment`, `deleteComment`, `createDocumentBlobs`, `createVersionRef`, `createRedirectRef`, `createTombstoneRef`, `createCapability`, `createContact`, `updateContact`, `deleteContact`, `signDocumentChange` and `signBlob`. Each accepts its SDK input without a signer argument. Signing helpers return their SDK result without publishing (`signDocumentChange.changeCid` is serialized as a string); `signBlob(body)` returns `{cid, data, ts, signer}` for a custom dag-json blob body. <!-- id:3q0DXpCt -->
  - `seed.comments.create({content, target?, version?})` signs and publishes in one call. By default it comments on this app's document at the displayed revision; another target needs a version, and visibility follows the target. It returns `{commentId, version}`. <!-- id:bU8KLCs3 -->

For a new document, use the SDK's document builder and publish the resulting signed blobs: <!-- id:a6FBSsSF -->

```js <!-- id:SqtVqNUo -->
const {account} = await seed.context()
const {blobs} = await seed.hm.createDocumentBlobs({
  space: account,
  path: '/apps/data',
  ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'App data'}]}],
})
await seed.publish({blobs})
```

Use versioned document changes for edits, rather than recreating an existing document. Keep Submit disabled while an operation is pending, preserve input on denial/error, and clear it only on success. Grants are intentionally not remembered across app instances; broader permissions do not merge apps' local storage namespaces. Protocol permissions still govern what the selected account may change. <!-- id:hlf7GHeT -->

# Where the pieces are <!-- id:wbK6irDo -->

- **Daemon.** `GET /ipfs/{cid}/{path}` walks a UnixFS directory the way an IPFS gateway does, types entries by extension, and serves a folder as its `index.html` (`backend/hmnet/filemanager.go`). The web app's `/hm/api/file/<cid>/<path>` proxies the same. <!-- id:pHJnvTPq -->
- **Shared.** `@shm/shared/document-app` holds the scheme, bridge, `DocumentAppSDK` TypeScript interface and message guard. `document-app-content` uses the HM SDK for block helpers and session-authorized account requests and SDK signing; `directoryToIpfsBlobs` in `@seed-hypermedia/client` builds the folder's blocks. <!-- id:9Pr7yzT- -->
- **Desktop.** `app-document-apps.ts` registers the scheme and serves app files from the daemon; `app-window-policy.ts` admits app frames; `DocumentAppView` in `@shm/ui/document-app` embeds the app and answers the bridge. <!-- id:WPSC9ID0 -->
- **Chat.** A ```` ```seed-app ```` fence whose body is the document's `hm://` URL embeds the running app in an agent's reply (`DocumentAppEmbed`), the same sandbox and bridge as the document view. <!-- id:I8baoO6i -->
- **Web.** Normal document URLs render apps using `/hm/app-runner` on the same hostname/port. `/hm/api/app` checks that the requested bundle belongs to the readable document revision, then returns HTML as inert data. The parent transfers it through a launch-bound MessageChannel into the opaque sandbox. No wildcard DNS, per-app domains or separate runtime service are required. Raw `/hm/api/file` responses are sandboxed without scripts to prevent direct navigation from executing uploads with Seed authority. <!-- id:FbM8tviL -->

# Local web sandbox prototype <!-- id:KsQP6ACj -->

Run the normal web app with `direnv exec . pnpm web`, then open the document at `http://localhost:3000/hm/<account>/<path>`. The daemon must already be running as usual. No workshop server is needed. For the same-origin runtime's Chromium, Firefox and WebKit regression tests, run `direnv exec . node --test frontend/apps/web/scripts/document-app-browser.e2e.mjs`. These test storage isolation across viewers/resources/revisions, public profile resolution, account-bridge transport, native storage/DOM/fetch blocking, late-result revocation, and direct runner visits. <!-- id:FpokQ7ZJ -->

The earlier workshop in `scripts/document-app-demo/` is retained as an experiment; ports 53110/53111 are not part of the integrated runtime. Web apps currently require inline scripts/styles, embedded assets, and click handlers rather than form submission; relative asset files are not implemented. The workshop uses its own experimental permission model; the integrated runtime uses the full-account session grant described above. Local state is browser-local, not synced or encrypted, and updated app code can read that resource's existing state. The prior workshop's navigation probe demonstrates that blocking fetch does not prevent every data leak. <!-- id:HsssNQvy -->
