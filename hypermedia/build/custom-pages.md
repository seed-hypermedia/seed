---
name: Custom HTML Pages
summary: This page shows how to build a custom HTML page, from its data model to a published and tested document, and gives the order to work in.
---
A **custom HTML page** is a [document](../protocol/documents.md) that carries a web page. Its [metadata](../metadata.md) declares `type: hm://hyper.media/page`. Its `html` attribute is an `ipfs://<cid>` that names a UnixFS folder, and the folder's `index.html` is the page. ([CID](../cid.md) explains the identifier.) <!-- id:4p_wlxmi -->

When someone opens the document in Seed, the page fills the main view, without document margins, header, tabs or footer. Breadcrumbs and the document browser stay. People, [Comments](../protocol/comments.md), Citations and Attributes open as panels beside the page, from the options menu in the breadcrumbs. Editing still shows the underlying document. The folder is a file the document references, so it [syncs](../protocol/network.md) with the document: share the document and the page arrives with it.

This page is the builder's overview. [Page](../page.md) explains the idea. Work in this order:

1. Define the data: schemas, collections and records, before any interface. See "Data before UI" below.
2. Declare the page's [input](../page-input.md), if it takes any, and publish that schema before the HTML.
3. Write the HTML against [the page SDK](./page-sdk.md), the reference for every `window.seed` call.
4. Publish it as a document. See "Publishing and validation" below.
5. Test it as a viewer would, with [the page sandbox](./page-sandbox.md) in mind: what runs, what asks for approval, and what the viewer can revoke.

A page that belongs to an [app](../app.md) can also call the app's [tools](../tool.md). [Building an app](./building-an-app.md) covers the app, its tools and its [triggers](../trigger.md).

# How a page gets built

An [agent](../agent.md) builds a page with the ordinary [`write` verb](../agent/write.md): <!-- id:s4mOJM7z -->

1. The agent writes the HTML under its [memory](../agent/memory.md).
2. It writes a document with `options.page` naming that folder, or a single HTML file.
3. The server publishes the folder to IPFS as a UnixFS directory, in the same publish as the document change. The document's `html` attribute points at the folder.
4. The write result tells the agent to share the document's `hm://` URL, which opens the full page view.

A page does not run inside a chat. A page is always a document.

# Data before UI <!-- id:6DfnJi96 -->

A page that keeps user data needs its data model first. The agent defines or reuses [HM schemas](../schema.md), creates Seed documents bound to those schemas, and only then builds the interface the user asked for. <!-- id:IqUmyUJo -->

For example, a task tracker should have:

- a Task type document (`schemaDefinition`);
- a task collection (`childAttributesSchema`);
- one editable document per task (`attributesSchema`, name, status and the requested fields).

Store the real collection and type URLs in the page's metadata. The data then stays available through ordinary Seed documents and other pages, whatever happens to the HTML bundle.

The agent's `~/tools/write/pages` guide gives the workflow and a working task data adapter. <!-- id:LcAwU0H8 -->

- `seed.directory` and `seed.resource` read records. `seed.watch.directory` and `seed.watch.resource` keep those reads up to date, so the page never needs to poll. See [live reads](./page-sdk.md#live-reads).
- `seed.publishDocument` creates and edits records, with the rights of the current viewer.
- An update keeps the document's genesis and generation and uses its current base version.
- During setup, decide which [space](../protocol/spaces.md) holds the data, whether it is private, and who can write it. A collection that the agent owns and the user cannot edit is not a finished page.

Rules for `seed.storage`: <!-- id:r-6CxFKU -->

- Use it only for optional interface preferences on one device, or for temporary unsaved drafts, unless the user clearly asks for data that stays on one device.
- Never fall back to local storage when a Seed read or write fails or is denied.
- Existing local records need a clear migration. Keep the originals until the publish and the read-back succeed.
- A page with no data to keep does not need schemas.

Test the data layer: <!-- id:R4XFSnY0 -->

- Create, read and update a record. Then open the page again with empty local state.
- Read the same record through ordinary Seed tools.
- This tests that data is saved. It does not test sync between hosts. Treat those as two tests.
- The publish result reports `dataPersistenceTested: false`. Syntax and asset checks cannot prove that the data layer works, even if the source mentions Seed write methods.

# Publishing and validation

Publishing with `write(..., options: {page: ...})` uses `pageTarget: "web-desktop"` unless you set another. <!-- id:6idmCJKm -->

- With `"web-desktop"`, the publisher parses the JavaScript without running it. It rejects unsupported external assets and module scripts before publishing. So the bundle must put its scripts, styles and images inline: classic scripts, inline styles and data images.
- `pageTarget: "desktop"` allows asset files in the folder, used by relative path. Such a page runs only on the desktop.
- The write result includes `pageValidation`, tied to the bundle's CID. It has the syntax results and `runtimeTested: false`, `interactionTested: false`, `dataPersistenceTested: false`.
- These checks do not run the page. They do not prove that it starts or behaves well. "Generated", "syntax-checked", "published", "read back", "opened" and "tested by using it" are six different results.
- A dry run does not publish.
- Before an agent retries a failed publish, it must read back what was published.
- An agent must never describe `seed.storage` as sync between devices, as backup, or as encrypted storage.

A page written directly under an app or an agent's document gets its [card embed](../block/embed-view.md) on that host in the same publish. Deleting the page removes the embed.

# Authoring checks and save failures <!-- id:3eoiQBQZ -->

When an agent publishes a page that creates or edits records, it passes `options.pageData` with the HM URLs of the collections the page writes to. The publisher then checks two things for each collection: that it is bound to a schema, and that the agent's owner already has the right to create child records there. <!-- id:qNmae6H9 -->

The agent's own signing key proves nothing about whether the user can edit the collection. When access is missing:

- The result names the user, the owner of the collection and the access that is needed.
- If one of the agent's own enabled [signing identities](../agent/identity.md) owns that space, the result includes the WRITER grants that would fix it, as dry runs.
- The agent offers that fix to the person it is talking to. It asks first, unless that person allowed it before. Then it checks access again.
- The agent does not move the data or ask for wider page trust as a first answer.
- A writer grant does not give the right to manage permissions.

This check does not run the interface and does not prove that data is saved. Test adding a record, reading it back, editing it, and opening the page again. Configuration attributes are optional: store the collection and type URLs in one place, and add metadata only when the page reads it.

On the desktop, the page's first `window.seed` calls wait until the host says the frame is ready. A page should still keep Add and Save disabled until its data has loaded. If loading fails, the page should show the error and a way to retry. It should not show an empty collection, which would mislead. <!-- id:BFmmdNLZ -->

# See also

- [Page](../page.md), the concept.
- [Page input](../page-input.md) for schema-defined URL input.
- [The page SDK](./page-sdk.md) for the calls.
- [The page sandbox](./page-sandbox.md) for isolation, approvals and where the code is.
- [Building an app](./building-an-app.md) for apps, tools and triggers.
- [Schemas](../schema.md) for the data model a page stores its records in.
