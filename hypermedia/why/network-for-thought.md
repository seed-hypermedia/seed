---
name: A network for thought
summary: Why Seed is a local-first network of nodes rather than a platform, what "you do not log in, you exist" means in practice, and how peer-to-peer and the ordinary web fit together.
---
Seed is not a platform or an app. It is a network for thought. There is no central source of truth, knowledge is replicated across the nodes of the people who care about it, and a shared understanding emerges from many local states rather than from one database.

That is a design choice about where power sits. Most collaboration tools concentrate identity, information and interaction inside one provider. Seed lets a community keep its own copy, connect to others, and decide where its information lives, who can participate, and which rules organise the work.

# You do not log in, you exist

Your identity is a cryptographic key, not a username at someone's service. It signs your contributions and lets others verify them. There is nothing to log into because there is no account server: you exist in the network as soon as you hold a key. [Identity](../protocol/identity.md) explains keys, devices and the vault that keeps a key safe.

# Your node is your local brain

To participate you run a node: the Seed desktop app, or a Seed site on a server. Your node stores your own documents and the documents of the sites you joined, syncs with other nodes directly, and serves everything you have to the peers that ask. It works offline, and it keeps working if every other node disappears.

Sync is deliberately not gossip. Your node does not replicate everything it hears about; it fetches the sites you joined, the material they link, and the comments on them. The team's phrase is that sync is scoped by identity, trust and relevance, not epidemic. [Network](../protocol/network.md) describes discovery, reconciliation and the peers a node talks to.

# Communities, not feeds

Knowledge in Seed lives in spaces, each owned by an account, arranged as documents with paths, with comments alongside. Joining a site is publishing a [contact](../contact.md) that says so, which also subscribes your node to it. Documents and conversations belong together: comments are where quick thoughts happen, and documents are where they get structured.

# The ordinary web is still there

A space can be published as a site at a web domain, either hosted at hyper.media or on a server you run. A site is just a node with a domain and a web app in front of it, so browsers can read every document, comment with a signed web key, and follow the same links. Every site also serves the [Seed API](../rpc.md), and any `https://site/hm/<account>/<path>` URL can be turned back into an `hm://` address. [Sites](../protocol/sites.md) has the details.

The team's own description of the tradeoff: a view of a distributed object can be at most two of correct, decentralised and fast. Seed loads the fast, correct answer from an authoritative server first, and then confirms it against the peer-to-peer network in the background. That is why the web app feels like an ordinary website while the desktop app holds a full copy.

# What ships today

- Full nodes in the desktop app and in every site; scoped sync over libp2p with set reconciliation and Bitswap.
- Hosted sites and self-hosted sites with the same software; [Self-hosting](../build/self-hosting.md).
- Web signing with delegated session keys; [Sign in with Seed](../build/sign-in.md).

# What is still direction

Private spaces and private networks with their own sync and permission rules are being designed; today's private documents are a first phase. There is no distributed hash table in use, so discovery leans on known sites and peer exchange. See [Where this is going](../protocol/roadmap.md).

# See also

- [Sites](../protocol/sites.md), [Network](../protocol/network.md), [Privacy](../protocol/privacy.md)
- [The Seed software](../apps.md)
