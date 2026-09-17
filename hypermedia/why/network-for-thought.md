---
name: A network for thought
summary: Why Seed is a local-first network of nodes, what having no login means in practice, and how peer-to-peer and the ordinary web fit together.
---
Seed is a network for thought. There is no central source of truth. Knowledge is copied across the nodes of the people who care about it, and a shared understanding grows out of many local copies, with no single database behind them.

That is a choice about where power sits. Most collaboration tools keep identity, information and interaction inside one provider. Seed lets a community keep its own copy, connect to others, and decide where its information lives, who can take part, and which rules organise the work.

# No login, just a key

Your identity is a cryptographic key. No service holds a username for you. The key signs your contributions and lets others verify them. There is nothing to log into because there is no account server: you exist in the network as soon as you hold a key. [Identity](../protocol/identity.md) explains keys, devices and the [vault](../apps/vault.md) that keeps a key safe.

# Your node holds your copy

To take part you run a node: the [Seed desktop app](../apps/desktop.md), or a Seed site on a server. Your node stores your own [documents](../protocol/documents.md) and the documents of the sites you joined. It syncs with other nodes directly and serves everything it has to the [peers](../protocol/network.md) that ask. It works offline, and it keeps working if every other node disappears.

Sync does not gossip. Your node does not copy everything it hears about. It fetches the sites you joined, the material they link, and the comments on them. In the team's words, sync is scoped by identity, trust and relevance, and it does not spread like an epidemic. [Network](../protocol/network.md) describes discovery, reconciliation and the peers a node talks to.

# Communities

Knowledge in Seed lives in [spaces](../protocol/documents.md). Each space is owned by an account and holds documents with paths, with [comments](../protocol/comments.md) alongside. Joining a site means publishing a [contact](../contact.md) that says so, which also subscribes your node to the site. Documents and conversations belong together: comments hold quick thoughts, and documents give them structure.

# The ordinary web is still there

A space can be published as a [site](../protocol/sites.md) at a web domain, hosted at hyper.media or on a server you run. A site is a node with a domain and a [web app](../apps/web.md) in front of it. Browsers can read every document, comment with a signed web key, and follow the same links. Every site also serves the [Seed API](../rpc.md), and any `https://site/hm/<account>/<path>` URL can be turned back into an `hm://` address. [Sites](../protocol/sites.md) has the details.

The team describes the tradeoff this way: a view of a distributed object can be at most two of correct, decentralised and fast. Seed first loads the fast, correct answer from an authoritative server, then confirms it against the peer-to-peer network in the background. So the web app feels like an ordinary website, while the desktop app holds a full copy.

# What ships today

- Full nodes run in the desktop app and in every site. Sync is scoped and runs over libp2p with set reconciliation and Bitswap.
- Hosted sites and self-hosted sites run the same software. See [Self-hosting](../build/self-hosting.md).
- Web signing uses delegated session keys. See [Sign in with Seed](../build/sign-in.md).

# What is still direction

Private spaces and private networks with their own sync and permission rules are being designed. Today's [private documents](../protocol/privacy.md) are a first phase. No distributed hash table is in use, so discovery relies on known sites and peer exchange. See [Where this is going](../protocol/roadmap.md).

# See also

- [Sites](../protocol/sites.md)
- [Network](../protocol/network.md)
- [Privacy](../protocol/privacy.md)
- [Identity](../protocol/identity.md)
- [The Seed software](../apps.md)
- [The end of broken links](./broken-links.md)
