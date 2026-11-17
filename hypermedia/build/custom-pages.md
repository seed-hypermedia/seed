---
name: Custom HTML Pages
summary: How to build a custom HTML page, from its data model to a published and tested document, with the order to work in and the pages that hold the SDK and sandbox details.
---
A **custom HTML page** is a [document](../protocol/documents.md) that carries a web page. Its [metadata](../metadata.md) declares `type: hm://hyper.media/page` and has an `html` attribute, an `ipfs://<cid>` that names a UnixFS folder whose `index.html` is a page. Web-compatible bundles inline their scripts, styles and images; desktop-only bundles can use relative asset files. When the document is opened in Seed, the page fills the main view without document margins, header, tabs or footer. Breadcrumbs and the document browser remain. People, Comments, Citations and Attributes open from the breadcrumb options menu as panels beside the page. Editing still shows the underlying document. The folder is a file the document references, so it syncs with the document: share the document and the page arrives with it. <!-- id:4p_wlxmi -->

This page is the builder's overview. [Page](../page.md) explains the concept. Work in this order:

1. Define the data: schemas, collections and records, before any interface. See "Data before UI" below.
2. Declare the page's [input](../page-input.md), if it takes any, and publish that schema before the HTML.
3. Write the HTML against [the page SDK](./page-sdk.md), the reference for every `window.seed` call.
4. Publish it as a document. See "Publishing and validation" below.
5. Test it as a viewer would, with [the page sandbox](./page-sandbox.md) in mind: what runs, what asks for approval, and what the viewer can revoke.

A page that belongs to an app can also call the app's tools. [Building an app](./building-an-app.md) covers the app, its tools and its triggers.

# How a page gets built

An agent builds such a page with the ordinary [`write` verb](../agent.md): it writes the HTML under its memory and then writes a document with `options.page` naming that folder (or single HTML file). The folder is published to IPFS as a UnixFS directory in the same publish as the document change, and the document's `html` attribute points at it. The write result tells the agent to share the document's `hm://` URL, which opens the full page view. A page does not run inside a chat. There is no separate page tool and no page that is not a document. <!-- id:s4mOJM7z -->

# Data before UI <!-- id:6DfnJi96 -->

For pages with durable user data, agents must define or reuse HM schemas, establish schema-bound Seed resources, and then build the interface to the user's specifications. A task tracker should have a Task type document (`schemaDefinition`), a task collection (`childAttributesSchema`) and individually editable task documents (`attributesSchema`, name, status and the requested fields). Store real collection/type URLs in the page's metadata. The data remains available through ordinary Seed documents and other pages, independently of the HTML bundle. <!-- id:IqUmyUJo -->

The agent's `~/tools/write/pages` guide supplies the workflow and an executable task data adapter. `seed.directory` and `seed.resource` read records; `seed.publishDocument` creates and edits them using the current viewer's authority. Updates preserve the document's genesis/generation and use its current base version. Establish the intended user/shared data space, privacy and write access during setup; an agent-owned collection that the user cannot edit is not a completed page. <!-- id:LcAwU0H8 -->

Use `seed.storage` only for optional device-local UI preferences or temporary unsaved drafts, unless the user explicitly requests local-only primary data. Never substitute local storage when a Seed read/write fails or is denied. Existing local records need an explicit migration that preserves the originals until publication/read-back succeeds. Stateless pages do not need artificial schemas. <!-- id:r-6CxFKU -->

Verify create/read/update and reopen with local state empty, then read the same record through ordinary Seed tools. Distinguish that persistence test from a cross-host sync test. Publication receipts report `dataPersistenceTested: false` because syntax/asset checks cannot establish a working data layer, even if the source mentions Seed write methods. <!-- id:R4XFSnY0 -->

# Publishing and validation

Publishing with `write(..., options: {page: ...})` defaults to `pageTarget: "web-desktop"`. It parses JavaScript without executing it and rejects unsupported external assets or module scripts before publishing. Use inline classic scripts, styles and data images. `pageTarget: "desktop"` explicitly permits bundled asset files. The write receipt includes `pageValidation`, bound to the bundle CID, with syntax results and `runtimeTested: false`, `interactionTested: false`, `dataPersistenceTested: false`. These static checks do not prove startup or behavior; generated, syntax-checked, published, read back, opened and interaction-tested are distinct outcomes. Dry runs do not publish. Agents must read back publication state before retrying a failed operation and must never describe `seed.storage` as cross-device sync, backup or encrypted storage. <!-- id:6idmCJKm -->

A page written directly under an [app](../app.md) or an agent's document gets its card embed on that host in the same publish, and deleting it removes the embed.

# Authoring checks and save failures <!-- id:3eoiQBQZ -->

When publishing a page that creates or edits records, pass `options.pageData` with the writable collection HM URLs. The publisher checks each collection's schema binding and the agent owner's existing authority to create child records. An agent signing key is not evidence that the user can edit that collection. When access is missing, the result identifies the user, collection owner and required scope. If an enabled signing identity owns that space, it supplies dry-run WRITER grant proposals for the existing collections. The agent uses the signed message sender and current page/conversation context to offer the concrete repair, honors prior authorization or asks for the specified grant, then rechecks access. It does not default to moving data or broader page trust. A writer grant is not permission-management authority. This preflight does not execute the UI or prove persistence; test Add, read-back, edit, and reopening separately. Configuration attributes are optional: store collection/type URLs in one place, and only add metadata when the page reads it. <!-- id:qNmae6H9 -->

Desktop SDK startup calls wait for the host's frame-ready signal. Pages should still disable Add/Save until data initialization finishes and retain a visible error/retry state when initialization fails, rather than showing a misleading empty collection. <!-- id:BFmmdNLZ -->

# See also

- [Page](../page.md), the concept.
- [Page input](../page-input.md) for schema-defined URL input.
- [The page SDK](./page-sdk.md) for the calls.
- [The page sandbox](./page-sandbox.md) for isolation, approvals and where the code is.
- [Building an app](./building-an-app.md) for apps, tools and triggers.
- [Schemas](../schema.md) for the data model a page stores its records in.
