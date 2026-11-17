---
name: Custom domains
summary: This page shows how to serve a Seed site at a domain you own, for a site on the hosted service, a site you host yourself, and an enterprise node that moves to a new hostname.
---
A Seed [site](../protocol/sites.md) shows a [space](../protocol/spaces.md) at a web domain, such as `example.org`. This page says how to put a site on a domain you own. There are three cases, and each has its own section below.

The first thing to check, in every case: the domain's DNS record must lead to the right server. `dig +short A <your domain>` shows where it leads.

What a domain means for a space is explained in [sites](../protocol/sites.md). The owner's steps in the app are in [publishing a space to a domain](./publishing-to-a-domain.md).

# A site on the hosted service <!-- id:ZBecOkd6 -->

Your site is on the hosted service at `yoursite.hyper.media`. You can serve it at your own domain and keep it hosted. This section describes the hosted service, which can change. <!-- id:VQS9iJXY -->

1. In the [Seed app](../software/desktop.md), open the site.
2. Choose **Publish Custom Domain** from the options menu, enter the domain and confirm.
3. At your DNS provider, add an `ALIAS` record, or a flattened `CNAME` record, that points at `yoursite.hyper.media`. If you use Cloudflare, turn proxying off.
4. If your provider cannot make such a record, add an `A` record instead. It points at the address of the hosted service, which `dig +short A hyper.media` prints.
5. Keep the app open while the DNS change spreads. This usually takes less than ten minutes. Then the site is live on the new domain.

# A site you host yourself

1. Point an `A` record for the domain at your server. Do this before you run the deploy script.
2. Give the script the full URL as the public hostname.

The proxy gets its certificate from Let's Encrypt once the name leads to the server. [Self-hosting](./self-hosting.md) has all the steps. To change the hostname later, run `seed-deploy deploy --reconfigure`.

# An enterprise node

`seed-deploy set-hostname https://new.example.org` moves an [enterprise node](./enterprise-node.md#changing-the-hostname) to a new hostname. It also republishes the space's [home document](../protocol/spaces.md) with the new address. The old hostname keeps redirecting to the new one.

Set the hostname before you invite anyone. A passkey belongs to the domain it was made on, so it stops working when the domain changes.

# See also

- [Sites](../protocol/sites.md), what a domain is to a space
- [Publishing a space to a domain](./publishing-to-a-domain.md), the owner's steps and the setup status page
- [Web app](../software/web.md), the program that serves the site
- [Self-hosting](./self-hosting.md)
- [Enterprise node](./enterprise-node.md)
