---
name: The Page Sandbox
summary: How Seed isolates a custom HTML page as untrusted code, and how the viewer approves, narrows and revokes what the page may run, read, sign and publish.
---
A [custom HTML page](../page.md) is code written by someone else that runs on the viewer's machine. This page describes what keeps it contained: the origin it runs in, the bridge it must go through, the approvals for running, reading, signing and publishing, and how a viewer takes them back. The calls themselves are in [the page SDK](./page-sdk.md).

# What the page may do <!-- id:sEBfqfoQ -->

The page is untrusted code: once a document is shared, someone else's page runs on the viewer's machine beside the viewer's data. So the page runs in an origin of its own, with no network, no access to the daemon or its secret, and no access to the Seed window. Desktop permits assets from the page folder. Web uses an opaque iframe and HTTP CSP sandbox on the same Seed origin; inline scripts/styles and embedded images are supported. Use self-contained HTML for both platforms. Sandboxing does not guarantee that data disclosed to page code cannot leave it through navigation. <!-- id:MyRnFAuR -->
  - **Origin.** The desktop serves the folder at `seed-page://<host>/`, where the host is a fresh unpredictable value for each launch, bound to the canonical document, immutable bundle CID and selected viewer. Opening a different revision cannot replace assets served to an already-open revision. Native storage starts fresh on each launch and is cleared when the owning window closes or releases it; it cannot silently carry previously disclosed data into another launch. Optional device-local UI state uses `seed.storage.get/set`, whose host-managed namespace is `(viewer account, canonical document HMID)`, independent of the page revision. Different resources never share that state, even if their HTML is identical. <!-- id:qkgetBC6 -->
  - **Bridge.** The page includes `<script src="/.seed/client.js"></script>`, which defines `window.seed`. Except for the synchronous display helper `seed.stringify`, each method posts a request to the Seed window that embeds the page and resolves with its answer; the Seed window answers the allowed calls. Web installs the API before page code runs and ignores the desktop bridge include. Both platforms allow reads within the page’s own space by default and gate other content, viewer identity and saved-state reads through Seed-owned approval UI. <!-- id:Q1Xrhos_ -->

A `<form>` works on both hosts when its `submit` handler calls `preventDefault()`: the web sandbox allows the submit event (`allow-forms`) while `form-action 'none'` stops a form from navigating or posting anywhere.

State saved with `seed.storage` is local to the browser or device. It is not synced and not encrypted. Updated page code inherits the remembered rules of its document, and reading existing state requires read approval.

# Running a page

Running a page is separate from granting it access. Pages from joined sites, your own site or the current web site's identity run automatically. Other sites show **Run page**, explaining that code can mislead, consume resources and open links. Joining is optional. Seed remembers the approval for that page document, including later updates, for the selected account on this device. The prompt names the page's authors and offers **Always run pages by these authors**: after that, any page whose authors are all trusted runs without asking, so a page by fewer of them runs too, but a page with any other author asks again. **Page permissions** lists the page's run approval and its trusted authors under **Running**, each revocable; revoking stops the open page. Running permits reads of content within the page document’s own space, limited by the viewer’s existing protocol access. Viewer identity, other spaces and saved page state still require approval. <!-- id:srhIdCrl -->

# Access reviews

The first operation needing access opens a Seed-owned review, defaulting to **Allow once**. **Allow more like this** offers narrower remembered rules alongside all-reading, any-signing or all-publishing, independently. A plain-text explanation below the choices describes the selected policy; broad permissions need no extra confirmation checkbox. Comment reviews show the text and target site; exact payload details and a SHA-256 fingerprint are available. Rules are remembered for `(selected viewer, canonical page document ID)` on this device, including future code updates. <!-- id:SDHt-XnV -->
  - **Reading:** documents, the space profile and queries confined to the page document’s own space are allowed by default, including after resetting additional permissions. Other spaces require approval for a resource, a site, or all reads. Identity/profile/public-key access and saved page data need their own read approval. Search, comments and queries with an unbounded cross-site footprint currently offer once or all-reading; they cannot silently inherit a site grant. Resolved document targets are checked again before disclosure. <!-- id:Jm0jcobp -->
  - **Signing:** approve one signature, an established signature type on one site, that type everywhere, or any signing. Comment creation, comment edits/deletions, document changes, references, contact changes and lasting capabilities are distinct. Classification validates the canonical signing bytes and actual signing principal against the protocol schema; the page cannot choose a label to obtain broader access. Types without a provable site binding have no site option. Unrecognized payloads offer only once or any-signing. <!-- id:0RMtjjbQ -->
  - **Publishing:** exact recognized envelopes signed and approved in this launch may be published without another prompt. Modified blobs, extra attachments and previously signed/imported payloads need publication consent. Generic `PublishBlobs` requests use the same check. <!-- id:qZL-0mVf -->

A call to one of the app's tools (`seed.app.call`) is reviewed too: the viewer allows it once, for that tool, or for every tool of the app. Pages of one app share their permissions.

# Inspecting and revoking

`seed.permissions.request()` returns `{grants}` without granting anything. **Page permissions** in the breadcrumb menu lets the viewer inspect, revoke individual rules or reset additional permissions; `seed.permissions.revoke()` resets the page's rules too. Revocation also aborts active/queued calls and propagates to other open views on the same origin. Closing, changing account or changing code cancels in-flight calls while keeping remembered rules. Allow-once approvals never coalesce different operations. <!-- id:__iSnD5h -->

A page can exfiltrate data after you disclose it: the sandbox limits ambient browser authority, not what the page can do with data it receives. Reading and signing are therefore independent. Keys remain in Seed. Revocation cannot recall disclosed information, completed signatures, publications or lasting protocol capabilities already issued. <!-- id:ICIxoM5i -->

Permissions are not pinned to a version of the page: a rule covers later versions of the same page document. There is no undo for a signature or a publication.

# Where the pieces are <!-- id:wbK6irDo -->

- **Daemon.** `GET /ipfs/{cid}/{path}` walks a UnixFS directory the way an IPFS gateway does, types entries by extension, and serves a folder as its `index.html` (`backend/hmnet/filemanager.go`). The web page's `/hm/api/file/<cid>/<path>` proxies the same. <!-- id:pHJnvTPq -->
- **Shared.** `@shm/shared/document-page` holds the scheme, bridge, `DocumentPageSDK` TypeScript interface and message guard. `document-page-content` uses the HM SDK for block helpers and permission-controlled account requests and SDK signing; `document-page-permissions` classifies actual bytes and manages revocable scoped rules; `directoryToIpfsBlobs` in `@seed-hypermedia/client` builds the folder's blocks. <!-- id:9Pr7yzT- -->
- **Desktop.** `page-document-pages.ts` registers the scheme and serves page files from the daemon; `page-window-policy.ts` admits page frames; `DocumentPageView` in `@shm/ui/document-page` embeds the page and answers the bridge. <!-- id:WPSC9ID0 -->
- **Web.** Normal document URLs render pages using `/hm/page-runner` on the same hostname/port. `/hm/api/page` checks that the requested bundle belongs to the readable document revision, then returns HTML as inert data. The parent transfers it through a launch-bound MessageChannel into the opaque sandbox. No wildcard DNS, per-page domains or separate runtime service are required. Raw `/hm/api/file` responses are sandboxed without scripts to prevent direct navigation from executing uploads with Seed authority. <!-- id:FbM8tviL -->

# See also

- [Page](../page.md), the concept.
- [The page SDK](./page-sdk.md) for the calls these rules govern.
- [Custom HTML pages](./custom-pages.md) for the build workflow.
- [Permissions](../protocol/permissions.md) for what the protocol lets the viewer's account change.
- [The desktop app](../software/desktop.md) and [the web app](../software/web.md), the two hosts.
