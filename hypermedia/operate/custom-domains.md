---
name: Custom domains
summary: How to serve a Seed site at your own domain, for a site on the hosted service, a self-hosted site, and an enterprise node that moves to a new hostname.
---
A Seed [site](../protocol/sites.md) answers at a web [domain](../protocol/sites.md). This page says how to put a site on a domain you own, in the three situations an operator meets. What a domain means for a space is explained in [sites](../protocol/sites.md), and the owner's steps in the app are in [publishing a space to a domain](./publishing-to-a-domain.md).

# A site on the hosted service <!-- id:ZBecOkd6 -->

If your site is on the hosted service at `yoursite.hyper.media`, you can still serve it at your own [domain](../protocol/sites.md) without self-hosting. In the Seed app, open the site, choose **Publish Custom Domain** from the options menu, enter the domain and confirm. Then in DNS either add an `ALIAS` or flattened `CNAME` record pointing at `yoursite.hyper.media` (turn off proxying if you use Cloudflare), or, when your provider cannot do that, an `A` record pointing at the hosted service's address, which `dig +short A hyper.media` prints. Keep the app open while DNS propagates, usually within ten minutes, and the site goes live on the new domain. <!-- id:VQS9iJXY -->

# A self-hosted site

Point an `A` record for the domain at your server before you run the deploy script, and give the script the full URL as the public hostname. The proxy gets its certificate from Let's Encrypt once the name resolves to the server. [Self-hosting](./self-hosting.md) has the steps. To change the hostname later, run `seed-deploy deploy --reconfigure`.

# An enterprise node

`seed-deploy set-hostname https://new.example.org` moves an [enterprise node](./enterprise-node.md#changing-the-hostname) to a new hostname and republishes the space's home document with the new address. The previous hostname keeps redirecting. Set the hostname before inviting anyone, because passkeys are bound to the domain they were registered on.

# See also

- [Sites](../protocol/sites.md), what a domain is to a space
- [Publishing a space to a domain](./publishing-to-a-domain.md), the owner's workflow and the setup status page
- [Web app](../software/web.md), the program that serves the site
- [Self-hosting](./self-hosting.md)
- [Enterprise node](./enterprise-node.md)
