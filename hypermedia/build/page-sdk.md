---
name: The Page SDK
summary: "The reference for window.seed, the bridge a custom HTML page uses to read context, input and records, to sign and publish as the viewer, to call its app's tools, and to open links."
---
A [custom HTML page](../page.md) talks to Hypermedia through one object, `window.seed`. The page includes `<script src="/.seed/client.js"></script>`, and every call is a request to the Seed client around the page, which answers the calls the viewer allows. This page lists the calls. [The page sandbox](./page-sandbox.md) says which of them need the viewer's approval, and [custom HTML pages](./custom-pages.md) is the overview for builders.

The API is the same on web and desktop. Requests are limited to 8 MiB including binary bytes, with at most 32 pending calls.

# Context, profile, reads and storage

`seed.context()` returns `{protocol: 1, document, version, account, page}`; `account` is the selected viewer UID or null, not `viewer`. `seed.profile()` returns `{id, name}` for that viewer or null when signed out. Use `const profile = await seed.profile(); heading.textContent = profile?.name ? "Hello, " + profile.name + "!" : "Hello, friend!"`. Profile data comes from the Account API, not a document at `/:profile`; that URL is supported as a compatibility alias for the selected viewer. Handle SDK errors separately from signed-out state. `seed.resource(hmUrl)` and `seed.directory(hmUrl, {all})` read within the page’s own space without prompting; other spaces require approval on both platforms. `seed.storage.get(key)` returns saved JSON or null; `seed.storage.set(key, value)` persists JSON (64 keys, 128 characters/key, 16 KiB/value). Reading, signing and publishing have independent rules described below. <!-- id:W8d7Tl95 -->

The browser SDK returns `seed.resource(url)` as `{type, id, url, document}` for documents, with the document's `metadata`, `content` and `version` also on the result; the agent read tool's `resource` envelope is not part of this API. `seed.directory(url)` returns an array of records, each with `url` (its address as a string, for links, keys and comparisons), `id` (which prints as that URL) and `metadata`. Both take a URL, an hm id or a record. `seed.app.call(tool, input)` sends records and hm ids in `input` as their URLs too. `seed.publishDocument(input)` selects an existing scoped capability for the viewer and confirms the published version by reading the target before resolving. It rejects missing write authority before signing. A stored blob with an unconfirmed document is not a successful save; read the reported address before retrying. <!-- id:n4Z2jI-5 -->

# Input

`seed.input.get()`, `seed.input.push(values)`, `seed.input.replace(values)` and `seed.input.onChange(listener)` read and change the page's URL input. [Page input](../page-input.md) describes them with the schema and the URL form.

# Content helpers <!-- id:YSnzkVRV -->

custom HTML pages use a host-owned facade over `@seed-hypermedia/client`, on both desktop and web: <!-- id:LB_GsYHp -->

```js <!-- id:4euGDfTy -->
const content = await seed.hm.parseMarkdown(messageInput.value)
const {commentId, version} = await seed.comments.create({content}) // Seed reviews the signature
```

`seed.hm.parseMarkdown` returns HM block nodes with IDs and annotations. `seed.hm.validateContent(content)` validates page-constructed block nodes. Both are asynchronous, use the existing SDK in the host, and have no signing side effects. `seed.hm.unpackHmId(url)` parses HM URLs. <!-- id:FtuStJku -->

# Requests, signing and publishing

The asynchronous calls: <!-- id:-PeUsTvd -->
  - `seed.request(key, input)` exposes all requests in the SDK's `HMRequest` union with schema-validated inputs. `seed.resource(url)` and `seed.directory(url, {all})` are convenience reads. <!-- id:JEL8XDJg -->
  - `seed.publish({blobs: [{cid, data}]})` publishes arbitrary blobs; `data` is a `Uint8Array`. `seed.publishDocument(recordUrl, {name?, metadata?, content?, visibility?})` creates the record at that address or edits it: `metadata` fields are text, whole numbers, true/false or nested objects (never lists), a record or hm id given as a value is stored as its hm:// URL, and `content` is the body as markdown, which an edit replaces. The viewer approves one save. The raw form `seed.publishDocument({account, path, changes, baseVersion?, genesis?, generation?, capability?, visibility?})` prepares, signs and publishes protobuf document operations. `account` is the target space; signing always uses the selected viewer. <!-- id:Gy79meik -->
  - `seed.signer.getPublicKey()` and `seed.signer.sign(bytes)` implement `HMSigner`, for an SDK bundled inline into the page. The page receives public-key/signature bytes, never private keys. Web sign-in may use a delegated device key whose signing principal differs from the selected account; the protocol still enforces its delegation. <!-- id:hI7cG6fU -->
  - `seed.hm` provides the SDK's `createComment`, `updateComment`, `deleteComment`, `createDocumentBlobs`, `createVersionRef`, `createRedirectRef`, `createTombstoneRef`, `createCapability`, `createContact`, `updateContact`, `deleteContact`, `signDocumentChange` and `signBlob`. Each accepts its SDK input without a signer argument. Signing helpers return their SDK result without publishing (`signDocumentChange.changeCid` is serialized as a string); `signBlob(body)` returns `{cid, data, ts, signer}` for a custom dag-json blob body. <!-- id:3q0DXpCt -->
  - `seed.comments.create({content, target?, version?})` signs and publishes in one call. By default it comments on this page's document at the displayed revision; another target needs a version, and visibility follows the target. It returns `{commentId, version}`. <!-- id:bU8KLCs3 -->

# The app's tools and config

A page directly under an [app](../app.md) or an agent's document belongs to it. A page outside a host has no app, and both calls reject.

- `seed.app.context()` resolves to `{app, publicConfig}`: the hm:// id of the [app](../app.md) the page belongs to and its public config, the same context the app's tools get without private config, which never reaches a page.
- `seed.app.call(tool, input)` runs a tool of the [app](../app.md) the page belongs to (a page directly under an app) on the app's server, signed as the viewer, who is recorded as having run it. `tool` is the tool's name in the app (`"get-weather"`) or its hm:// URL; it resolves to the tool's output and rejects with its error. The viewer allows it once, for that tool, or for every tool of the app. Pages of one app share their permissions: they are remembered for the app, not the page.

# Creating and editing documents

For a new document, use the SDK's document builder and publish the resulting signed blobs: <!-- id:a6FBSsSF -->

```js <!-- id:SqtVqNUo -->
const {account} = await seed.context()
const {blobs} = await seed.hm.createDocumentBlobs({
  space: account,
  path: '/pages/data',
  ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Page data'}]}],
})
await seed.publish({blobs})
```

Use versioned document changes for edits, rather than recreating an existing document. Keep Submit disabled while an operation is pending, preserve input on denial/error, and clear it only on success. Remembered grants survive page instances and code updates; broader permissions do not merge pages' local storage namespaces. Protocol permissions still govern what the selected account may change. <!-- id:hlf7GHeT -->

# Linking and runtime compatibility <!-- id:17tMApB7 -->

Use ordinary anchors such as `<a href="hm://<account>/notes?v=<version>#<block>">Notes</a>` or `await seed.open(url, {newWindow: false})`. The host opens Hypermedia links outside the page frame. Explicit HTTP(S) links retain their server, query and fragment instead of being rewritten to the current site. `_blank`, modifier clicks and middle clicks request a new tab/window; browser popup rules still apply. Unsupported schemes and credential-bearing URLs are rejected. Catch SDK errors to preserve page input; host navigation errors also appear as notifications. Anchor failures dispatch `seed-link-error` on the page window. Navigation needs no account-access grant. <!-- id:MgUiUh_j -->

`await seed.runtime()` returns the running SDK version and implementation digest, supported bridge methods, platform, limits, authority (`"scoped-page-permissions"`) and storage semantics. Check for the method before calling it on older hosts; a guide or source checkout does not prove that a running host has been updated. `seed.stringify(value)` formats SDK BigInts and byte arrays for display, not signing or round-trip serialization. <!-- id:7IHH63oo -->

# See also

- [Page](../page.md) and [page input](../page-input.md).
- [The page sandbox](./page-sandbox.md) for approvals, revocation and isolation.
- [Custom HTML pages](./custom-pages.md) for the build workflow.
- [The SDK](./sdk.md), `@seed-hypermedia/client`, which the page helpers wrap.
- [Tool](../tool.md) for what `seed.app.call` runs.
