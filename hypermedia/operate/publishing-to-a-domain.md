---
name: Publishing a space to a domain
summary: How the owner of a space gives it a web address from the desktop app or a browser, with a free Seed Hosting address, a custom domain or a self-hosted server, and how the address is changed or handed over later.
---
A space becomes a website when a [site](../protocol/sites.md) serves it at a domain. This page is the owner's workflow for getting there: choose where the site runs, sign in to Seed Hosting if you use it, point a custom domain at it, and change or transfer the address later. The [desktop app](../software/desktop.md) and the [web app](../software/web.md) share the same dialogs, so the steps are the same in both. To run the server yourself, start with [Self-hosting](./self-hosting.md) and come back here for the registration step.

# The invitation

The first successful publication of a public space home opens an invitation to give it a web address. The owner can continue directly into Seed Hosting or reopen **Web Domain** from the home document's options menu later. The dialog stays open across navigation, including publication resumed after signing in through the vault. Private spaces, child documents, and updates to existing homes do not trigger the invitation. <!-- id:webDomainInvite -->

In the desktop app the invitation offers **Publish to a Domain**, which opens the hosting workflow to choose a free Seed address or a custom domain. **Not now** dismisses the invitation. Space settings has a **Web Domain** page for publishing and removing a web domain. <!-- id:xI5Dn8Ok -->

# Choosing where the site runs

The web and desktop publishing dialogs share their domain and hosting choices, self-hosting guide, setup-URL registration flow, and publication confirmation. There are two paths. <!-- id:webDomainManage -->

- **Self-hosted.** Follow the setup guide and paste the server's setup URL. No Seed Hosting login is required. Public servers need HTTPS when publishing from an HTTPS page; localhost HTTP remains available for development.
- **Seed Hosting.** Sign in, then choose a free Seed address. An interrupted connection can resume without reserving another address.

# Signing in to Seed Hosting <!-- id:mW_AKbPg -->

Seed Hosting sign-in uses a four-digit emailed code, or trusted vault verification for eligible new hosting accounts.

In the browser, Seed Hosting first tries the signed email proof from Seed Vault, then falls back to a four-digit email code when needed. Vault sign-in carries the email proof privately in the callback fragment and stores it with the browser identity. Publishing signs in automatically when a proof or hosting session is available; the account footer offers **Switch account** for choosing another hosting account. Hosting accepts this proof only for new accounts from a trusted vault; existing hosting accounts still require a fresh email code. [The vault](../software/vault.md) explains how the proof is signed.

Logging out of the web app clears its hosting credentials and attempts to revoke the hosting session. Logging out of the desktop app also clears its hosting credentials and cached sites, and revokes the hosting session when the service is reachable.

# Custom domains

Custom domains include DNS instructions and status checks. Custom-domain setup opens a full-page status view at `/:settings/web-domain/<hostname>` (or `/hm/<space-uid>/:settings/web-domain/<hostname>` on a gateway). Refreshing or returning through **Space Settings → Web Domain → Open Domain Setup** restores the selected domain and resumes checking with the same hosting account. The page distinguishes DNS waiting, HTTPS setup, publication updates, and completion. The browser checks every 20 seconds while open; Seed Hosting checks DNS every minute, and propagation timing depends on the DNS provider. Completed status is verified against the owned hosting domain and the space’s published address. If browser setup state is missing, **Resume Domain Setup** reconnects to the existing owned domain without creating another one. Signing in again preserves the setup URL; a different hosting account cannot see or finish another account’s pending setup. <!-- id:webDomainProgress -->

[Self-hosting](./self-hosting.md) lists the DNS records a custom domain on the hosted service needs.

# Changing the address and transferring hosting

**Change Site Address** and **Transfer Hosting** are available only when the signed-in hosting account owns a site registered to this space and its published URL matches that site's address or custom domain. Self-hosted sites do not expose these controls. A hosting transfer moves management to an existing hosting account; it does not transfer the Seed identity or content permissions. Active paid services must stop before a transfer, and dedicated hosting must stop before a rename. <!-- id:Gmvlux4S -->

Renaming preserves the site identity and custom domains. The desktop updates the space's published URL when it points to the old hosting address; a custom primary domain stays unchanged. Pending publication updates are retained so an interrupted move can be completed without moving the hosting address again. <!-- id:TGB5fYAE -->

# How registration works

A site is linked to a space by registration: the site records the space's [account](../protocol/identity.md) and a source [peer](../protocol/network.md) to fetch the content from. From the desktop app, the source peer is the app's own daemon. [The web app](../software/web.md) describes the site's side.

From a browser, the browser registers the server using the current gateway peer and signs the address update with the owner’s delegation. Browser registration reads the current gateway's peer information from `/hm/api/config` and sends the registration secret directly to the hosted site's `/hm/api/register`. The destination site is selected from its Host or forwarded-host header, never the publishing browser's Origin, including when local development uses different ports. That endpoint supports cross-origin POST and OPTIONS without browser credentials; the secret still authorizes registration. The gateway is the source peer because browsers have no local daemon. Browser setup supports both managed Seed Hosting and self-hosted setup links. <!-- id:webDomainRegister -->

# See also

- [Sites](../protocol/sites.md), for what a site is and how a domain maps to a space.
- [Self-hosting](./self-hosting.md), for running the server and for the DNS records of a custom domain.
- [The web app](../software/web.md), for `config.json`, the registration routes and space settings in the browser.
- [The desktop app](../software/desktop.md) and [The vault](../software/vault.md).
- [Sign in with Seed](../build/sign-in.md), for the delegation a browser signs with.
