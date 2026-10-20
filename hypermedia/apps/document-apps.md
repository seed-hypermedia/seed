---
name: Document apps
summary: A document whose `app` attribute names a UnixFS folder with an index.html opens as that app, sandboxed, and reads Hypermedia as the viewer through a small postMessage bridge.
---
A **document app** is a [document](../protocol/documents.md) that carries a web app. Its [metadata](../metadata.md) has an `app` attribute, an `ipfs://<cid>` that names a UnixFS folder whose `index.html` is a self-contained app (its own scripts, styles and images beside it, by relative path). When the document is opened in Seed, the app is shown in place of the document body. The folder is a file the document references, so it syncs with the document: share the document and the app arrives with it.

The agent runtime builds such apps on request. The [`apps` tool](../agent.md) takes a folder (or a single HTML file) from agent memory and a `document` address, publishes the folder to IPFS and creates or updates the document with the `app` attribute. The same tool without a document gives a session-private preview in the chat, the way it did before.

# What the app may do

The app is untrusted code: once a document is shared, someone else's app runs on the viewer's machine beside the viewer's data. So the app runs in an origin of its own, with no network, no access to the daemon or its secret, and no access to the Seed window. Its content-security policy is `default-src 'self'`: it loads only from its own folder.

- **Origin.** The desktop serves the folder at `seed-app://<host>/`, where the host is a digest of the document id. The origin belongs to the document, not to one revision, so `localStorage` survives the author publishing a new version, while two documents never share state.
- **Bridge.** The app includes `<script src="/.seed/client.js"></script>`, which defines `window.seed`. Each method posts a request to the Seed window that embeds the app and resolves with its answer; the Seed window answers with the viewer's own client, so the app reads exactly what the viewer can read.
- **Reads only.** `seed.context()` returns the document, the version being viewed, the viewer's account and the app's CID. `seed.resource(hmUrl)` returns a document or comment. `seed.directory(hmUrl, {all})` lists the documents under a path. Writes are not offered yet; when they are, each will ask the viewer first, the way agent actions in the [web browser](./desktop.md) do.

# Where the pieces are

- **Daemon.** `GET /ipfs/{cid}/{path}` walks a UnixFS directory the way an IPFS gateway does, types entries by extension, and serves a folder as its `index.html` (`backend/hmnet/filemanager.go`). The web app's `/hm/api/file/<cid>/<path>` proxies the same.
- **Shared.** `@shm/shared/document-app` holds the scheme, the bridge protocol, the client script and the message guard; `directoryToIpfsBlobs` in `@seed-hypermedia/client` builds the folder's blocks.
- **Desktop.** `app-document-apps.ts` registers the scheme and serves app files from the daemon; `app-window-policy.ts` admits app frames; `DocumentAppView` in `@shm/ui/document-app` embeds the app and answers the bridge.
- **Web.** The web app shows a note to open the document in the desktop app; a sandboxed web embed is a follow-up.
