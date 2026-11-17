---
name: The Page Sandbox
summary: Seed isolates a custom HTML page as untrusted code, and the viewer approves, narrows and takes back what the page may run, read, sign and publish.
---
A [custom HTML page](../page.md) is code written by someone else that runs on the viewer's machine. So Seed runs it in a sandbox: a closed box that the page cannot leave. For example, a page cannot read the viewer's name until the viewer says yes.

This page describes what keeps a page contained: the origin it runs in, the bridge it must go through, the approvals for running, reading, signing and publishing, and how a viewer takes them back. The calls themselves are in [the page SDK](./page-sdk.md).

# What the page may do <!-- id:sEBfqfoQ -->

The page is untrusted code. Once a [document](../protocol/documents.md) is shared, someone else's page runs on the viewer's machine, beside the viewer's data. So the page runs in a web origin of its own: <!-- id:MyRnFAuR -->

- It has no network access.
- It cannot reach the [daemon](../software/daemon.md) or the daemon's secret.
- It cannot reach the Seed window around it.

The two hosts differ a little:

- The desktop allows asset files from the page folder.
- The web uses an opaque iframe and an HTTP CSP sandbox on the same Seed origin. It supports inline scripts, inline styles and embedded images.

Use HTML that holds everything it needs, so it works on both. The sandbox does not promise that data the viewer gives to the page stays inside it. The page can still send it out by opening a link.

## The origin

On the desktop, each launch of a page gets a new address, `seed-page://<host>/`, that no other page can guess. The host part is tied to the page document, the fixed [CID](../cid.md) of its bundle and the selected viewer. Opening another version cannot replace the assets of a version that is already open. <!-- id:qkgetBC6 -->

## Storage

The browser's own storage starts empty on each launch. Seed clears it when the window that owns the page closes or lets it go. So data the viewer gave the page cannot quietly carry over to the next launch.

For optional interface state on one device, a page uses `seed.storage.get` and `seed.storage.set`. The host keeps that state under the viewer's [account](../protocol/identity.md) and the page document's id, whatever the page's version. Two different documents never share that state, even if their HTML is the same.

State saved with `seed.storage` stays in that browser or on that device. It is not synced and not encrypted. New page code gets the remembered rules of its document. Reading existing state needs read approval.

## The bridge

The page includes `<script src="/.seed/client.js"></script>`, which defines `window.seed`. Each method sends a request to the Seed window that holds the page, and resolves with the answer. The Seed window answers only the allowed calls. The one exception is `seed.stringify`, a display helper that runs inside the page. <!-- id:Q1Xrhos_ -->

On the web, Seed installs the API before the page's code runs, and ignores the script include.

Both hosts allow reads inside the page's own [space](../protocol/spaces.md) without asking. Other content, the viewer's identity and saved state each need an approval, in a dialog that Seed owns.

## Forms

A `<form>` works on both hosts when its `submit` handler calls `preventDefault()`. The web sandbox allows the submit event (`allow-forms`), and `form-action 'none'` stops a form from navigating or posting anywhere.

# Running a page

Letting a page run is separate from giving it access. <!-- id:srhIdCrl -->

- A page runs at once when it comes from a [site](../protocol/sites.md) you joined, from your own site, or from the web site you are visiting.
- A page from any other site shows **Run page**. The prompt explains that code can mislead, use resources and open links. You do not need to join the site.
- Seed remembers the approval for that page document, including later updates, for the selected account on this device.
- The prompt names the page's authors and offers **Always run pages by these authors**. After that, any page whose authors are all trusted runs without asking. A page by fewer of them runs too. A page with any other author asks again.
- **Page permissions** lists the page's run approval and its trusted authors under **Running**. You can revoke each one. Revoking stops the open page.

A running page may read content inside the page document's own space, as far as the viewer's own protocol access allows. The viewer's identity, other spaces and saved page state still need approval.

# Access reviews

The first operation that needs access opens a review, in a dialog that Seed owns. <!-- id:SDHt-XnV -->

- The default choice is **Allow once**.
- **Allow more like this** offers narrower rules that Seed remembers. It also offers all reading, any signing or all publishing. Each of the three is chosen on its own.
- A plain text below the choices explains the selected rule. A broad permission needs no extra checkbox.
- The review of a [comment](../protocol/comments.md) shows the text and the target site. The exact payload and a SHA-256 fingerprint are available.
- Seed remembers rules on this device for the selected viewer and the page document, or for the app when the page belongs to one. The rules cover future code updates.

## Reading

- Documents, the space's [profile](../profile.md) and queries that stay inside the page document's own space are allowed without asking. This stays true after a reset of additional permissions. <!-- id:Jm0jcobp -->
- Other spaces need approval: for one resource, for one site, or for all reads.
- The viewer's identity, profile and public key, and saved page data, each need their own read approval.
- Search, comments and queries that can reach any site offer only "once" or "all reading". They cannot quietly use a grant for one site.
- When a read resolves to a document, Seed checks that document again before it gives the data to the page.

## Signing

- The viewer can approve one signature, a known signature type on one site, that type everywhere, or any signing. <!-- id:0RMtjjbQ -->
- These are separate types: creating a comment, editing or deleting a comment, document changes, references, [contact](../protocol/contacts.md) changes and lasting [capabilities](../protocol/permissions.md).
- Seed looks at the real bytes being signed, and at the [principal](../principal.md) that really signs, to decide what kind of signature it is. The page cannot label a request as something safer.
- A type that cannot be tied to one site for certain has no site option.
- A payload that Seed does not recognize offers only "once" or "any signing".

## Publishing

- A page may publish, without another prompt, exactly the recognized envelopes that were signed and approved in this launch. <!-- id:qZL-0mVf -->
- Changed [blobs](../protocol/blobs.md), extra attachments, and payloads that were signed earlier or imported need consent to publish.
- Generic `PublishBlobs` requests go through the same check.

## Tool calls

Seed reviews a call to one of the host's tools (`seed.app.call`) too. The viewer allows it once, for that tool, or for every tool of the app. Pages of one app share their permissions.

# Inspecting and revoking

`seed.permissions.request()` returns `{grants}` and grants nothing. <!-- id:__iSnD5h -->

- **Page permissions** in the breadcrumb menu lets the viewer inspect the rules, revoke single rules, or choose **Reset additional permissions**.
- `seed.permissions.revoke()` resets the page's rules too.
- Revoking also stops calls that are running or waiting, and reaches other open views of the same page.
- Closing the page, changing the account or changing the code cancels calls in progress. The remembered rules stay.
- An **Allow once** approval covers one operation. Seed never joins different operations under it.

A page can send data away after you give it. The sandbox limits what the page can reach by itself. It does not limit what the page does with data it receives. This is why reading and signing are approved separately. Keys stay in Seed. Revoking cannot take back information the page already has, finished signatures, publications, or lasting protocol capabilities that were already issued. <!-- id:ICIxoM5i -->

A permission is not tied to one version of the page. A rule covers later versions of the same page document. A signature or a publication cannot be undone.

# Where the pieces are <!-- id:wbK6irDo -->

- **Daemon.** `GET /ipfs/{cid}/{path}` walks a UnixFS directory the way an IPFS gateway does. It sets each entry's type by its extension, and serves a folder as its `index.html` (`backend/hmnet/filemanager.go`). On the web, `/hm/api/file/<cid>/<path>` passes the same request on. <!-- id:pHJnvTPq -->
- **Shared.** `@shm/shared/document-page` holds the scheme, the bridge, the `DocumentPageSDK` TypeScript interface and the message guard. `document-page-content` uses [the SDK](./sdk.md) for the [block](../protocol/blocks.md) helpers, for account requests that need permission, and for signing. `document-page-permissions` classifies the real bytes and manages the rules. `directoryToIpfsBlobs` in `@seed-hypermedia/client` builds the folder's IPFS blocks. <!-- id:9Pr7yzT- -->
- **Desktop.** `app-document-pages.ts` registers the scheme and serves page files from the daemon. `app-window-policy.ts` admits page frames. `DocumentPageView` in `@shm/ui/document-page` embeds the page and answers the bridge. <!-- id:WPSC9ID0 -->
- **Web.** Normal document URLs show pages through `/hm/page-runner` on the same host name and port. `/hm/api/page` checks that the requested bundle belongs to a document version the viewer can read. Then it returns the HTML as plain data. The parent window passes it into the opaque sandbox through a MessageChannel made for that launch. This needs no wildcard DNS, no domain per page and no separate service. Raw `/hm/api/file` responses are sandboxed without scripts. So opening an uploaded file directly cannot run it with Seed's rights. <!-- id:FbM8tviL -->

# See also

- [Page](../page.md), the concept.
- [The page SDK](./page-sdk.md) for the calls these rules govern.
- [Custom HTML pages](./custom-pages.md) for the build workflow.
- [Permissions](../protocol/permissions.md) for what the protocol lets the viewer's account change.
- [The desktop app](../software/desktop.md) and [the web app](../software/web.md), the two hosts.
