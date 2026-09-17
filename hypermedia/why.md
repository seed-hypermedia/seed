---
name: Why Hypermedia
summary: The motivation behind the Hypermedia protocol, written for any reader, with one page per idea and a plain note on what is built and what is still direction.
---
The web lets anyone publish, but it forgets. It cannot prove who wrote what. And it gives you only two ways to reuse someone else's work: a fragile link, or a copy that looks like theft. Hypermedia tries to fix these three problems in the protocol itself, with no company in the middle.

This section makes the case. You do not need to know what a hash is to read it. Every term links to the [glossary](./glossary.md), and every claim links to the page that explains how it works. The [protocol tour](./protocol.md) tells the same story in precise terms.

# The four ideas

- [The end of broken links](./why/broken-links.md). A piece of content is named by a hash of its bytes, so its address does not depend on any server. A link to a Hypermedia [document](./protocol/documents.md) keeps working as long as anyone still holds a copy, and anyone who holds a copy can prove it is genuine.
- [Signed content, not server trust](./why/signed-content.md). Authors sign their own documents and [comments](./protocol/comments.md) on their own devices. You check the author's signature, whichever server delivered the bytes. This page also explains why the team did not build on ActivityPub.
- [Open editing](./why/open-editing.md). Documents are histories of signed changes. You can see who changed what, branch someone else's document into your own space, and merge their work back without giving them the keys. The model comes from git.
- [A network for thought](./why/network-for-thought.md). There is no login. You exist in the network as a [key](./protocol/identity.md). Your node holds your own copy of what you care about, talks to other nodes directly, and can publish to the ordinary web when you want a domain.

[Inspirations](./why/inspirations.md) names the systems these ideas come from, from Engelbart's NLS and Nelson's Xanadu to IPFS, Secure Scuttlebutt, UCAN and Automerge.

# What this is not

Hypermedia is not a social network, a blockchain, or a walled garden. It has no token and no global consensus, and you do not have to use the team's servers. Seed, the software, is open source under the Apache license. The team runs hosted [sites](./protocol/sites.md) at hyper.media as a convenience, and a site you host yourself is a full peer.

# What is built and what is not

Most of this section describes what ships today: [signed blobs](./protocol/blobs.md), content addressing, change histories, branching, [capabilities](./protocol/permissions.md), peer-to-peer [sync](./protocol/network.md), and web publishing. Two things are still direction, and each page says so where it matters.

- **Web of trust.** The idea is that communities filter spam through their contacts. Today it exists only as a public address book plus explicit permissions. There is no trust graph in the code.
- **Permissions.** The permission model is being redesigned. [Where this is going](./protocol/roadmap.md) collects the decided direction, with dates.

# See also

- [The Hypermedia protocol](./protocol.md), the precise version of this story.
- [Glossary](./glossary.md), every term in one line.
- [Building on Hypermedia](./build.md), when you are ready to write code.
- [The Seed software](./apps.md), the programs that implement the protocol.
- [History](./history.md), dated design records behind the current model.
