---
name: Publishing a space to a domain
summary: This page shows how the owner of a space gives it a web address from the desktop app or a browser, with a free Seed Hosting address, a custom domain or a server they host themselves, and how to change the address or hand the hosting to someone else later.
---
A [space](../protocol/spaces.md) becomes a website when a [site](../protocol/sites.md) serves it at a domain. This page is for the owner of a space. It gives the steps: choose where the site runs, sign in to Seed Hosting if you use it, point your own domain at it, and change or hand over the address later.

The first thing to know: you start from **Web Domain**, in the options menu of the space's [home document](../protocol/spaces.md) or in the space's settings. The [desktop app](../software/desktop.md) and the [web app](../software/web.md) use the same dialogs, so the steps are the same in both.

To run the server yourself, start with [Self-hosting](./self-hosting.md) and come back here for the registration step. The parts of this page about Seed Hosting describe the hosted service, which can change.

# The invitation

The first time you publish the home [document](../protocol/documents.md) of a public space, the app invites you to give the space a web address. <!-- id:webDomainInvite -->

- You can go straight on into Seed Hosting, or open **Web Domain** from the home document's options menu later.
- The dialog stays open while you move around the app. It also stays open when publishing continues after you sign in through the vault.
- The app does not invite you for a private space, for a child document, or for an update to a home document that already exists.

In the desktop app the invitation offers **Publish to a Domain**. It opens the hosting steps, where you choose a free Seed address or your own domain. **Not now** closes the invitation. The space's settings have a **Web Domain** page for publishing and removing a web domain. <!-- id:xI5Dn8Ok -->

# Choosing where the site runs

The web app and the desktop app share the same choices, the same self-hosting guide, the same registration steps and the same confirmation. There are two paths. <!-- id:webDomainManage -->

- **Self-hosted.** Follow the setup guide and paste the server's setup URL. You need no Seed Hosting account. When you publish from an HTTPS page, a public server must use HTTPS too. Plain HTTP on localhost still works for development.
- **Seed Hosting.** Sign in, then choose a free Seed address. If the connection breaks, you can continue later without reserving another address.

# Signing in to Seed Hosting <!-- id:mW_AKbPg -->

You sign in to Seed Hosting with a four-digit code sent by email. A new hosting account can also be created with a proof from a trusted vault, with no code.

In the browser, sign-in works like this:

- Seed Hosting first tries the signed email proof from Seed Vault. It falls back to the four-digit email code when it must.
- Vault sign-in passes the email proof privately, in the fragment of the callback URL, and stores it with the browser identity.
- Publishing signs you in by itself when a proof or a hosting session is there. **Switch account** in the account footer lets you choose another hosting account.
- Hosting accepts the proof only for a new account, from a trusted vault. An existing hosting account still needs a fresh email code.

[The vault](../software/vault.md) explains how the proof is signed.

Logging out of the web app clears its hosting sign-in and tries to end the hosting session. Logging out of the desktop app also clears its hosting sign-in and its stored list of sites, and ends the hosting session when the service can be reached.

# Custom domains

When you use your own domain, the app shows the DNS records to make and checks them for you. <!-- id:webDomainProgress -->

- **The status page.** Setup opens a full page at `/:settings/web-domain/<hostname>`, or `/hm/<space-uid>/:settings/web-domain/<hostname>` on a gateway. The page shows which stage you are in: waiting for DNS, setting up HTTPS, updating the publication, or done.
- **Coming back.** Reload the page, or go to **Space Settings → Web Domain → Open Domain Setup**. The app picks the same domain again and continues checking with the same hosting account.
- **How often it checks.** The browser checks every 20 seconds while the page is open. Seed Hosting checks DNS every minute. How fast a DNS change spreads depends on your DNS provider.
- **Done.** The app reports "done" only after it has checked the domain against the hosting account that owns it and against the space's published address.
- **Lost setup state.** If the browser lost its setup state, **Resume Domain Setup** connects to the domain you already own. It does not create another one.
- **Accounts.** Signing in again keeps the setup URL. A different hosting account cannot see or finish the setup of another account.

[Custom domains](./custom-domains.md) lists the DNS records a custom domain needs.

# Changing the address and transferring hosting

**Change Space Address** and **Transfer Hosting** show only when two things are true. The hosting account you are signed in with owns a site registered to this space. And the space's published URL matches that site's address or custom domain. Sites you host yourself do not have these controls. <!-- id:Gmvlux4S -->

- A transfer moves the management of the hosting to another hosting account that already exists. It does not move the Seed identity, and it does not change who may edit the content.
- Paid services that are active must stop before a transfer.
- Dedicated hosting must stop before a rename.

A rename keeps the site's identity and its custom domains. The desktop app updates the space's published URL when that URL points at the old hosting address. A custom domain that is the main address stays as it is. Publication updates that are still waiting are kept, so a move that was interrupted can be finished without moving the hosting address again. <!-- id:TGB5fYAE -->

# How registration works

Registration links a site to a space. The site records the space's [account](../protocol/identity.md) and a source [peer](../protocol/network.md) to get the content from. From the desktop app, the source peer is the app's own [daemon](../software/daemon.md). [The web app](../software/web.md) describes the site's side.

A browser has no daemon of its own. So from a browser: <!-- id:webDomainRegister -->

- The source peer is the gateway the browser is on. The browser reads that gateway's peer information from `/hm/api/config`.
- The browser sends the registration secret directly to `/hm/api/register` on the site.
- The site that gets registered is the one the request was sent to, not the one the browser page came from. The site reads this from the Host header or the forwarded-host header, never from the browser's Origin. This matters in local development, where the two use different ports.
- That endpoint accepts POST and OPTIONS from other origins without browser credentials. The secret is still what allows the registration.
- The browser signs the change of address with the owner's delegation.

This works for Seed Hosting and for a server you host yourself.

# See also

- [Sites](../protocol/sites.md), for what a site is and how a domain maps to a space.
- [Self-hosting](./self-hosting.md), for running the server, and [custom domains](./custom-domains.md), for the DNS records.
- [The web app](../software/web.md), for `config.json`, the registration routes and space settings in the browser.
- [The desktop app](../software/desktop.md) and [The vault](../software/vault.md).
- [Sign in with Seed](../build/sign-in.md), for the delegation a browser signs with.
