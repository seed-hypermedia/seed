---
name: The Page SDK
summary: "This is the reference for window.seed, the object a custom HTML page uses to read context, input and records, to sign and publish as the viewer, to call its host's tools, and to open links."
---
A [custom HTML page](../page.md) talks to Hypermedia through one object, `window.seed`. For example, `await seed.profile()` gives the page the viewer's name. The page includes `<script src="/.seed/client.js"></script>` to get the object.

Every call is a request to the Seed client around the page. The client answers the calls that the viewer allows. This page lists the calls. [The page sandbox](./page-sandbox.md) says which calls need the viewer's approval. [Custom HTML pages](./custom-pages.md) is the overview for builders.

The API is the same on web and desktop. One request can be at most 8 MiB, including binary bytes. At most 32 calls can be pending at once.

# Context, profile, reads and storage

Reading, signing and publishing each have their own approval rules, in [the page sandbox](./page-sandbox.md). The calls: <!-- id:W8d7Tl95 -->

- `seed.context()` returns `{protocol: 1, document, version, account, page}`. `account` is the [account](../protocol/identity.md) id (uid) of the selected viewer, or null. The field is named `account`, not `viewer`.
- `seed.profile()` returns `{id, name}` for that viewer, or null when nobody is signed in. For example: `const profile = await seed.profile(); heading.textContent = profile?.name ? "Hello, " + profile.name + "!" : "Hello, friend!"`. The [profile](../profile.md) data comes from the Account API, not from a document at `/:profile`. That URL still works, as another name for the selected viewer. Handle SDK errors apart from the signed-out case.
- `seed.resource(hmUrl)` reads one [document](../protocol/documents.md). `seed.directory(hmUrl, {all})` lists the documents under an address. Inside the page's own [space](../protocol/spaces.md) they read without asking. Other spaces need approval, on both platforms.
- `seed.storage.get(key)` returns saved JSON or null. `seed.storage.set(key, value)` saves JSON. The limits are 64 keys, 128 characters per key and 16 KiB per value.

What the reads return: <!-- id:n4Z2jI-5 -->

- `seed.resource(url)` returns `{type, id, url, document}` for a document. The document's `metadata`, `content` and `version` are also on the result. The `resource` envelope of the agent read tool is not part of this API.
- `seed.directory(url)` returns an array of records. Each has `url` (its address as a string, for links, keys and comparisons), `id` (which prints as that URL) and `metadata`.
- Both take a URL, an hm id or a record. `seed.app.call(tool, input)` also sends records and hm ids in `input` as their URLs.

`seed.publishDocument(input)` picks a [capability](../protocol/permissions.md) the viewer already holds for the target. If the viewer has no right to write, it rejects before signing. After publishing, it reads the target to confirm the new version, and only then resolves. A stored [blob](../protocol/blobs.md) with an unconfirmed document is not a successful save. Read the reported address before you retry.

# Live reads

A page can keep a read up to date without polling. A live read is called a watch.

- `seed.watch.resource(url, listener, onError?)` keeps `seed.resource(url)` current.
- `seed.watch.directory(url, {all}?, listener, onError?)` keeps `seed.directory(url, {all})` current.
- The listener gets the current value first, then each new value. The call returns a function. Call it to stop the watch.

How it works:

- The watch starts with the bridge method `watch.start`. Its first answer is exactly what the one-time read would return, with the same permission rules.
- After that, the host watches the data, not the page. The host reads again as the page when the data may have changed. It sends the new value (a `seed-data` message) only when the value is different from the last one it sent.
- On desktop, the app's activity feed tells the host about changes, about a second after a change reaches the [node](../software/daemon.md). The watch also keeps the node syncing that data, as it does for an open document.
- On the web, the server follows the activity feed and the browser listens. When a page starts its first watch, the tab opens one event stream, `GET /hm/api/changes?r=<resource>&d=<directory>`, naming up to 32 addresses it watches (`d` covers a directory and everything below it).
  - The stream only says "this address may have changed". It never carries content, so it needs no page permission. The read that follows still uses the page's own access.
  - One web server process follows the feed once for all its streams, and only while at least one stream is open. An idle watch costs one open connection.
  - While the stream is not live (connecting, dropped, refused because the server is at its stream limit, or silent for two missed heartbeats), the host checks watched data every 30 seconds and reconnects, waiting from one second up to a minute between tries. When the stream returns, watched data is read again once.
  - A tab hidden for 15 seconds closes its stream and opens it again when shown.
- A refresh never asks the viewer for permission. If no saved permission covers the read any more (a read allowed once, or a permission the viewer removed), the page keeps its last value and `onError` is called once. The next change tries again.
- A write the page makes itself (`seed.publishDocument`, `seed.publish`, `seed.comments.create`) refreshes its watches as soon as the write is confirmed.
- One page can hold at most 16 watches. They end when the page stops them, reloads, navigates away or closes.
- A read of a pinned version (`?v=`) is delivered once, because a pinned version cannot change.

Only Hypermedia reads can be watched. The output of `seed.app.call` cannot. If a [tool](../tool.md) or [trigger](../trigger.md) makes data that a page should show live, the tool writes it to documents and the page watches those.

# Input

`seed.input.get()`, `seed.input.push(values)`, `seed.input.replace(values)` and `seed.input.onChange(listener)` read and change the page's URL input. [Page input](../page-input.md) describes them with the schema and the URL form.

# Content helpers <!-- id:YSnzkVRV -->

Pages reach the content helpers of [the SDK](./sdk.md), `@seed-hypermedia/client`, through `seed.hm`, on both desktop and web: <!-- id:LB_GsYHp -->

```js <!-- id:4euGDfTy -->
const content = await seed.hm.parseMarkdown(messageInput.value)
const {commentId, version} = await seed.comments.create({content}) // Seed reviews the signature
```

- `seed.hm.parseMarkdown` returns HM [block nodes](../block/node.md), which hold [blocks](../protocol/blocks.md), with IDs and annotations.
- `seed.hm.validateContent(content)` checks block nodes that the page built itself.
- Both are asynchronous. They use the SDK inside the host, and they sign nothing.
- `seed.hm.unpackHmId(url)` parses [hm:// URLs](../protocol/urls.md). <!-- id:FtuStJku -->

# Requests, signing and publishing

The asynchronous calls: <!-- id:-PeUsTvd -->
  - `seed.request(key, input)` sends any request in the SDK's `HMRequest` union. The client checks the input against the request's schema. `seed.resource(url)` and `seed.directory(url, {all})` are shorter forms of two such reads. <!-- id:JEL8XDJg -->
  - `seed.publish({blobs: [{cid, data}]})` publishes any blobs. `data` is a `Uint8Array`. `seed.publishDocument(recordUrl, {name?, metadata?, content?, visibility?})` creates the record at that address, or edits it. `metadata` fields are text, whole numbers (other numbers are stored as text), true/false or nested objects, and never lists. A record or hm id given as a value is stored as its hm:// URL. `content` is the body as markdown, and an edit replaces the body. The viewer approves one save. The raw form `seed.publishDocument({account, path, changes, baseVersion?, genesis?, generation?, capability?, visibility?})` prepares, signs and publishes protobuf document operations. `account` is the target space. Signing always uses the selected viewer. <!-- id:Gy79meik -->
  - `seed.signer.getPublicKey()` and `seed.signer.sign(bytes)` implement `HMSigner`, for an SDK bundled inline into the page. The page receives public key and signature bytes, never private keys. On the web, sign-in may use a delegated [device key](../protocol/network.md). Its signing [principal](../principal.md) then differs from the selected account. The protocol still enforces the delegation. <!-- id:hI7cG6fU -->
  - `seed.hm` provides the SDK's `createComment`, `updateComment`, `deleteComment`, `createDocumentBlobs`, `createVersionRef`, `createRedirectRef`, `createTombstoneRef`, `createCapability`, `createContact`, `updateContact`, `deleteContact`, `signDocumentChange` and `signBlob`. Each takes its SDK input without a signer argument. The signing helpers return their SDK result and do not publish (`signDocumentChange.changeCid` comes back as a string). `signBlob(body)` returns `{cid, data, ts, signer}` for a custom [DAG-JSON](../schema/dag-json.md) blob body. <!-- id:3q0DXpCt -->
  - `seed.comments.create({content, target?, version?})` signs and publishes a [comment](../protocol/comments.md) in one call. Without a target, it comments on this page's document at the version on screen. Another target needs a version. The comment is as visible as its target. The call returns `{commentId, version}`. <!-- id:bU8KLCs3 -->

# The host's tools and config

A page directly under an [app](../app.md) or an [agent](../agent.md)'s document belongs to that host. A page outside a host has no host, and both calls reject.

`seed.app.context()` resolves to `{app, publicConfig}`. `app` is the hm:// id of the host the page belongs to, and `publicConfig` is its public config. This is the same context the host's tools get, without the private config. Private config never reaches a page.

`seed.app.call(tool, input)` runs a [tool](../tool.md) of the host the page belongs to, an app or an agent, on that host's server:

- `tool` is the tool's name in the host (`"get-weather"`) or its hm:// URL.
- `input` must be an object.
- The viewer must be signed in. The call is signed as the viewer, and the server records the viewer as the caller.
- The call resolves to the tool's output, and rejects with the tool's error.
- The viewer allows it once, for that tool, or for every tool of the host.
- Pages of one app share their permissions. Seed remembers them for the app, not for the page.
- The server records the input and the output, and call records are not private. Never send secrets through `seed.app.call`. See [tool](../tool.md).

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

Rules for edits:

- To edit, publish a change on top of the document's current version. Do not create the document again.
- Keep Submit disabled while an operation is pending.
- Keep the viewer's input when a save is denied or fails. Clear it only on success.
- Remembered approvals survive a reload of the page and updates of its code. Wider permissions do not join the local storage of different pages.
- Protocol permissions still decide what the selected account may change. <!-- id:hlf7GHeT -->

# Linking and runtime compatibility <!-- id:17tMApB7 -->

To link, use ordinary anchors such as `<a href="hm://<account>/notes?v=<version>#<block>">Notes</a>`, or call `await seed.open(url, {newWindow: false})`.

- The host opens Hypermedia links outside the page frame.
- An HTTP or HTTPS link keeps its server, query and fragment. Seed does not rewrite it to the current [site](../protocol/sites.md).
- `_blank`, a click with a modifier key and a middle click ask for a new tab or window. The browser's popup rules still apply.
- The host rejects schemes it does not support, and URLs that carry a user name or password.
- Catch SDK errors so the page keeps the viewer's input. The host also shows navigation errors as notifications.
- A failed anchor sends a `seed-link-error` event on the page window.
- Opening a link needs no approval. <!-- id:MgUiUh_j -->

`await seed.runtime()` describes the host that is running the page. It returns the SDK version and implementation digest, the supported bridge methods, the platform, the limits, the authority (`"scoped-page-permissions"`) and how storage behaves. Check that a method exists before you call it, because an older host may not have it. For example, live reads need a host whose bridge methods include `watch.start` (SDK 2.1.0 or later). A guide or a copy of the source does not prove that a running host is up to date.

`seed.stringify(value)` formats the SDK's BigInts and byte arrays for display. Do not use it for signing, or to save and load values. <!-- id:7IHH63oo -->

# See also

- [Page](../page.md) and [page input](../page-input.md).
- [The page sandbox](./page-sandbox.md) for approvals, revocation and isolation.
- [Custom HTML pages](./custom-pages.md) for the build workflow.
- [The SDK](./sdk.md), `@seed-hypermedia/client`, which the page helpers wrap.
- [Tool](../tool.md) for what `seed.app.call` runs.
