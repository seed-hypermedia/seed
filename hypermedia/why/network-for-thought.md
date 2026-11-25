---
name: A network for thought
summary: Seed is a network of nodes that each hold their own copy, where your identity is a key and not a login, and where the ordinary web still works.
---
Seed is a network for thought. No central database holds the truth. The people who care about a piece of knowledge each keep a copy on their own node, which is a computer that runs Seed. A shared understanding grows out of many local copies. <!-- id:CVzUjJ7h -->

That is a choice about who holds power. Most tools for working together keep your identity, your information and your conversations inside one company. Seed lets a community keep its own copy and connect to others. The community decides where its information lives, who can take part, and which rules organise the work. <!-- id:Bd2Ezd_j -->

# No login, just a key <!-- id:3GliSd_u -->

Your identity is a cryptographic key. No service holds a username for you. The key signs what you write, and others use it to verify your work. There is nothing to log into, because there is no account server. You exist in the network as soon as you hold a key. [Identity](../protocol/identity.md) explains keys, devices and the [vault](../software/vault.md) that keeps a key safe. <!-- id:oM34sNca -->

# Your node holds your copy <!-- id:7xohC80j -->

To take part you run a node: the [Seed app](../software/desktop.md) on your computer, or a Seed site on a server. Your node stores your own [documents](../protocol/documents.md) and the documents of the sites you joined. It syncs with other nodes directly, and it serves what it has to the [peers](../protocol/network.md) that ask. It works offline. It keeps working if every other node disappears. <!-- id:MPEPNm0H -->

Your node does not copy everything it hears about. It fetches the sites you joined, the material they link, and the comments on them. So what you sync depends on who you are and what you chose to follow. [Network](../protocol/network.md) describes how nodes find each other and compare what they hold. <!-- id:8agXig1y -->

# Communities <!-- id:bTh-MZ9z -->

Knowledge in Seed lives in [spaces](../protocol/spaces.md). An account owns each space. A space holds documents at paths, with [comments](../protocol/comments.md) beside them. To join a site, you publish a [contact](../protocol/contacts.md) that says so. Your node then also syncs that site. Documents and conversations belong together: a comment holds a quick thought, and a document gives thoughts a structure. <!-- id:K9hLaKfD -->

# The ordinary web is still there <!-- id:vcLIBSfN -->

You can publish a space as a [site](../protocol/sites.md) at a web domain, hosted at hyper.media or on a server you run. A site is a node with a domain and a [web app](../software/web.md) in front of it. In a browser, people can read every document, comment with a key the browser holds, and follow the same links. Every site also serves the [Seed API](../build/web-api.md). Any `https://site/hm/<account>/<path>` address can be turned back into an `hm://` address. [Sites](../protocol/sites.md) has the details. <!-- id:dTqorlDq -->

There is a tradeoff. A view of shared data can be at most two of these three: correct, decentralised and fast. Seed first loads a fast, correct answer from the site's server. Then it checks that answer against the peer-to-peer network in the background. So the web app feels like an ordinary website, while the Seed app holds a full copy. <!-- id:vGg5fZGY -->

# Limits <!-- id:B_NaKuKl -->

- Hosted sites and [self-hosted](../operate/self-hosting.md) sites run the same software.
- There are no private spaces and no private networks with their own sync rules. [Private documents](../protocol/privacy.md) are the only private content.
- There is no global lookup table for content (no distributed hash table). A node finds content through the sites it knows and through peers that tell it about other peers.

# See also <!-- id:EUqwqOVd -->

- [Sites](../protocol/sites.md) <!-- id:3GeecdI_ -->
- [Network](../protocol/network.md) <!-- id:dr7n8Xxs -->
- [Privacy](../protocol/privacy.md) <!-- id:Jsnu0QRo -->
- [Identity](../protocol/identity.md) <!-- id:l_Tict9v -->
- [The Seed software](../software.md) <!-- id:W3JOuYg7 -->
- [The end of broken links](./broken-links.md) <!-- id:027knak7 -->
