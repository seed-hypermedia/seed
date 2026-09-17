---
name: Why Hypermedia
summary: The motivation behind the Hypermedia protocol, written for any reader, with one page per idea and an honest note on what is built and what is still direction.
---
The web lets anyone publish, but it forgets, it cannot prove who wrote what, and it gives you only two ways to reuse someone else's work: a fragile link or a copy that looks like theft. Hypermedia is an attempt to fix those three problems at the protocol level, without a company in the middle.

This section is the argument. It is written for readers who do not need to know what a hash is, and it links every term to the [glossary](./glossary.md) and every claim to the page that explains the mechanism. The [protocol tour](./protocol.md) is the same story told precisely.

# The four ideas

- [The end of broken links](./why/broken-links.md). Content is addressed by what it is, not where it lives. A link to a Hypermedia document keeps working as long as anyone still holds a copy, and anyone who holds a copy can prove it is genuine.
- [Signed content, not server trust](./why/signed-content.md). Authors sign their own documents and comments on their own devices. You verify the author, not the server that happened to deliver the bytes. This page also explains why the team did not build on ActivityPub.
- [Open editing](./why/open-editing.md). Documents are histories of signed changes, so you can see who changed what, branch someone else's document into your own space, and merge their work back without giving them the keys. The model is borrowed from git.
- [A network for thought](./why/network-for-thought.md). You do not log in; you exist in the network as a key. Your node holds your own copy of what you care about, speaks to other nodes directly, and can be published to the ordinary web when you want a domain.

Then [Inspirations](./why/inspirations.md) names the systems these ideas come from, from Engelbart's NLS and Nelson's Xanadu to IPFS, Secure Scuttlebutt, UCAN and Automerge.

# What this is not

Hypermedia is not a social network, not a blockchain, and not a walled garden. There is no token, no global consensus, and no requirement to use the team's servers. Seed, the software, is Apache-licensed and open source. The team runs hosted sites at hyper.media as a convenience, and a site you host yourself is a full peer.

# Honesty about the state of things

Most of this section describes what ships today: signed blobs, content addressing, change histories, branching, capabilities, peer-to-peer sync, and web publishing. Two things are direction rather than fact, and each page says so where it matters. The "web of trust" that would let communities filter spam through their contacts exists today only as a public address book plus explicit permissions; there is no trust graph in the code. And the permission model is being redesigned; [Where this is going](./protocol/roadmap.md) collects the decided direction, dated.

# See also

- [The Hypermedia protocol](./protocol.md), the precise version of this story.
- [Building on Hypermedia](./build.md), when you are ready to write code.
- [History](./history.md), dated design records behind the current model.
