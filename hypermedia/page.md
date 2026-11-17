---
name: Page
summary: A page is a document typed hm://hyper.media/page that carries an HTML bundle and an input schema, runs sandboxed in the viewer's client, and acts as the viewer under approvals the viewer gives step by step.
---
A **custom HTML page** is a resource with `type: hm://hyper.media/page`. Its `html` attribute points to an IPFS folder containing `index.html`; its `inputSchema` points to a published [Hypermedia schema](./schema.md). This is a page, rather than a larger application. <!-- id:m5PngYkS -->

A page is how an interface is published on Hypermedia. It is an ordinary [document](./protocol/documents.md), so it has an address, versions, authors and comments, and it syncs like any document: share the document and the page arrives with it. When the document is opened in Seed, the page fills the main view in place of the document body. A larger application is an [app](./app.md): pages for the interface, [tools](./tool.md) for server-side functions and [triggers](./trigger.md) for things that happen on their own.

# What a page is made of

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/page` |
| `name`, `summary` | the page's name and description, as on any document |
| `html` | `ipfs://<cid>` of a UnixFS folder whose `index.html` is the page |
| `inputSchema` | a published HM struct that defines the page's URL input. Required; a page without inputs uses [the empty page input](./page-input.md) |

The folder is a file the document references. A new version of the page is a new version of the document that points at a new folder.

# Where a page runs

A page runs in the viewer's client: the Seed desktop app or a browser on a Seed site. No server runs it. The client treats it as untrusted code, because once a document is shared, someone else's page runs on the viewer's machine beside the viewer's data. So the page gets an origin of its own, with no network access, no access to the daemon and no access to the Seed window around it. Everything it does with Hypermedia goes through one bridge, `window.seed`, which the client owns. [The page sandbox](./build/page-sandbox.md) describes the isolation.

A page does not run inside an agent chat. It opens in the full document view from its `hm://` URL.

# Acting as the viewer

A page has no identity and no key. It reads, writes and signs as the person looking at it, and only as far as that person allows:

- **Running** is the first approval. Pages from sites the viewer has joined, the viewer's own site, or the site being visited run at once. Any other page waits behind **Run page**.
- **Reading** inside the page's own space is allowed once it runs. Other spaces, the viewer's identity and saved page state each need approval.
- **Signing** and **publishing** open a review the first time. The viewer allows once, or allows more like it with a rule as narrow as one signature type on one site.

Approvals are remembered for the viewer and the page document on that device, and the viewer can inspect and revoke them. Keys never leave Seed. Protocol [permissions](./protocol/permissions.md) still decide what the viewer's account may change. [The page sandbox](./build/page-sandbox.md) has the rules, and [the page SDK](./build/page-sdk.md) has the calls.

# Input

A page takes typed input from its URL. `inputSchema` declares the fields, each field is a `p.<name>` query parameter, and the page reads and changes them through `seed.input`. Input is public URL state, so it never holds secrets. [Page input](./page-input.md) has the wire format.

# Pages, apps and agents

A page can stand alone: any document typed `hm://hyper.media/page` with an `html` folder is a page, wherever it lives. A page written directly under an [app](./app.md) or an [agent](./agent.md) belongs to that host, which lists it with a card embed. Belonging adds three things:

- The page can call the host's [tools](./tool.md) with `seed.app.call`, signed as the viewer, and read its public config with `seed.app.context()`. A page outside a host has no tools to call.
- Pages of one app share their permissions: they are remembered for the app, not for each page.
- The app can name the page as its `homePage`, shown when the app opens.

A page keeps its data in ordinary Seed documents with [schemas](./schema.md), not in the HTML bundle, so the data stays readable by other pages, by agents and by people. An agent builds pages with its [`write` verb](./agent/write.md).

# See also

- See [custom HTML pages](./build/custom-pages.md) for sandboxing, permissions, publishing and schema-backed data storage. <!-- id:h921QMIV -->
- [Page input](./page-input.md) for URL input and the empty default schema.
- [The page SDK](./build/page-sdk.md) for every `window.seed` call.
- [The page sandbox](./build/page-sandbox.md) for isolation, approvals and revocation.
- [App](./app.md), [Tool](./tool.md), [Trigger](./trigger.md) and [Agent](./agent.md).
