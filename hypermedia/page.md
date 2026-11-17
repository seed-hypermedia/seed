---
name: Page
summary: A page is a document typed hm://hyper.media/page that carries an HTML bundle and an input schema, runs sandboxed in the viewer's client, and acts as the viewer under approvals the viewer gives step by step.
---
A **page** is a [document](./protocol/documents.md) that carries a small web interface. For example, a reading-list page shows saved articles and has a form to add one. When someone opens the document in Seed, the interface fills the main view in place of the document body. <!-- id:m5PngYkS -->

The page's [metadata](./metadata.md) declares `type: hm://hyper.media/page`. A page is an ordinary document. So it has an address, versions, authors and [comments](./protocol/comments.md), and it [syncs](./protocol/network.md) like any document. Share the document and the page arrives with it.

A larger application is an [app](./app.md). An app has pages for the interface, [tools](./tool.md) for functions that run on a server, and [triggers](./trigger.md) for things that happen on their own.

# What a page is made of

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/page` |
| `name`, `summary` | the page's name and description, as on any document |
| `html` | `ipfs://<cid>` of a UnixFS folder whose `index.html` is the page |
| `inputSchema` | a published [HM struct](./schema.md) that defines the page's URL input. Required; a page without inputs uses [the empty page input](./page-input.md) |

The folder is a [file](./protocol/files.md) that the document references. A new version of the page is a new version of the document that points at a new folder.

# Where a page runs

A page runs in the viewer's client: the [Seed desktop app](./software/desktop.md) or a browser on a Seed [site](./protocol/sites.md). No server runs it.

The client treats the page as untrusted code. Once a document is shared, someone else's page runs on the viewer's machine, beside the viewer's data. So the client isolates the page:

- The page gets a web origin of its own.
- It has no network access.
- It cannot reach the [daemon](./software/daemon.md).
- It cannot reach the Seed window around it.

Everything the page does with Hypermedia goes through one bridge, `window.seed`, which the client owns. [The page sandbox](./build/page-sandbox.md) describes the isolation.

A page does not run inside an agent chat. It opens in the full document view from its [hm:// URL](./protocol/urls.md).

# Acting as the viewer

A page has no identity and no key. It reads, writes and signs as the person looking at it, and only as far as that person allows:

- **Running** is the first approval. A page runs at once when it comes from a site the viewer has joined, from the viewer's own site, or from the site being visited. Any other page waits behind **Run page**.
- **Reading** inside the page's own [space](./protocol/spaces.md) is allowed once the page runs. Other spaces, the viewer's identity and saved page state each need approval.
- **Signing** and **publishing** open a review the first time. The viewer allows once, or allows more like it with a rule. A rule can be as narrow as one signature type on one site.

Seed remembers approvals on that device for the viewer and the page document, or for the app when the page belongs to one. The viewer can inspect and revoke them. Keys never leave Seed. Protocol [permissions](./protocol/permissions.md) still decide what the viewer's [account](./protocol/identity.md) may change. [The page sandbox](./build/page-sandbox.md) has the rules, and [the page SDK](./build/page-sdk.md) has the calls.

# Input

A page takes typed input from its URL. `inputSchema` declares the fields. Each field is a `p.<name>` query parameter. The page reads and changes the fields through `seed.input`. Anyone who sees the URL sees the input, so never put secrets in it. [Page input](./page-input.md) has the exact format.

# Pages, apps and agents

A page can stand alone: the server accepts a page document anywhere. Agents are told to put every page under an app or an agent, because only there can it call tools.

A page one path segment under an [app](./app.md) or an [agent](./agent.md) belongs to that host. The host normally lists the page with a [card embed](./block/embed-view.md), and the host's Pages tab shows only listed pages. Belonging adds three things:

- The page can call the host's [tools](./tool.md) with `seed.app.call`, signed as the viewer. It can read the host's public config with `seed.app.context()`. A page outside a host has no tools to call.
- Pages of one app share their permissions. Seed remembers them for the app, not for each page.
- The app can name the page as its `homePage`, shown when the app opens.

A page keeps its data in ordinary Seed documents with [schemas](./schema.md), not in the HTML bundle. So other pages, agents and people can read the data too. An agent builds pages with its [`write` verb](./agent/write.md).

# See also

- [Custom HTML pages](./build/custom-pages.md) for the build workflow: data first, then publishing and checks. <!-- id:h921QMIV -->
- [Page input](./page-input.md) for URL input and the empty default schema.
- [The page SDK](./build/page-sdk.md) for every `window.seed` call.
- [The page sandbox](./build/page-sandbox.md) for isolation, approvals and revocation.
- [App](./app.md), [Tool](./tool.md), [Trigger](./trigger.md) and [Agent](./agent.md).
