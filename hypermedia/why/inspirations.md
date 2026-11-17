---
name: Inspirations
summary: Hypermedia borrows from earlier systems, from Engelbart's NLS and Nelson's Xanadu to IPFS, Secure Scuttlebutt, UCAN and Automerge, each described in a few lines.
---
None of the ideas in Hypermedia are new. Many earlier systems each had a part. Hypermedia joins those parts into one system: storage named by hash, data that merges without conflicts, links and embeds, peer-to-peer networking, signed permissions, and an interface people can use. This page names the sources so you can read them yourself. <!-- id:fFYrNbjz -->

# The vision <!-- id:H8pI3c8R -->

- **NLS (Engelbart, 1968).** The oN-Line System showed the mouse, hypertext, shared documents and live collaboration decades early. Its goal was to help groups of people think better together. Seed's design for [private documents](../protocol/privacy.md) and its [views](../protocol/urls.md) of content come from the "viewspecs" of NLS. <!-- id:yMtrxm9g -->
- **Xanadu (Nelson).** A universal hypertext where documents are never copied, only referenced. Every quotation stays linked to its source, every author gets credit, and every connection is permanent. Hypermedia's links to exact text, [embeds](../protocol/blocks.md) that keep the author's name, and links to exact versions put Xanadu's ideas into practice. <!-- id:LxSlC50S -->

# Content addressing and storage <!-- id:zmmZnDBv -->

- **IPFS.** Data named by a hash of its content. Hypermedia [blobs](../protocol/blobs.md) are IPFS blocks written in [DAG-CBOR](../schema/dag-cbor.md) and named by [CID](../cid.md). [Files](../protocol/files.md) travel in the IPFS file format, UnixFS. With IPFS and libp2p, Hypermedia does not need its own networking and can work on the knowledge layer. They are also shared ground where different networks can meet. <!-- id:mBry-Zqv -->
- **libp2p.** The networking toolkit under IPFS. Transport, discovery, encryption and routing are separate parts that fit together. The [Seed daemon](../software/daemon.md) is a libp2p node and serves its [peer-to-peer](../protocol/network.md) requests over it. <!-- id:HOCWblXF -->
- **Perkeep.** Personal data as a lifelong archive of unchanging blobs, each named by its hash. Applications are views over the data and do not own it. Perkeep asks what happens when your data outlives every app. Hypermedia asks the same question. <!-- id:nGK-KrqU -->
- **DAT and Beaker Browser.** Append-only logs and content addressing for sharing datasets and whole websites from your own machine. Beaker made the web feel writable again: to publish, you saved a file. <!-- id:jtDV_I7v -->

# Identity and trust <!-- id:HcEiIW5r -->

- **Bitcoin.** Agreement among participants who do not trust each other, and proof that a system with no centre can work at scale. Hypermedia takes the idea of a [key as identity](../protocol/identity.md) and none of the agreement machinery. It is not a blockchain. <!-- id:qTFQ1GI6 -->
- **Keybase.** Identity as a key, with public proofs that you own other accounts and devices, made simple enough for people to use. Another company bought Keybase. What followed shows that identity becomes fragile when trust moves back to one company. <!-- id:vBlwHSiG -->
- **Secure Scuttlebutt.** Signed append-only logs shared peer to peer. They spread through the people you know, with no ranking algorithm. SSB showed how a web of trust and links can deal with spam in an open network. It also showed that a decentralised network does not need to reach everyone. <!-- id:Q0DWGy1C -->
- **UCAN.** Signed tokens with which one actor gives another a limited permission. Hypermedia's [capabilities](../capability.md) belong to this family. They are simpler and cover only what the protocol needs. See [Permissions](../protocol/permissions.md). <!-- id:_O2aPC8a -->
- **Petnames.** A name is a local claim, and no global registry backs it. A Hypermedia [contact](../contact.md) is your public claim that you know an account by a certain name. <!-- id:Yk2yJpBH -->

# Collaboration <!-- id:FeBUURXG -->

- **Automerge.** A CRDT library. A CRDT is a data type that people can edit separately and then merge with no conflicts and no coordination. So working together feels like working locally. Hypermedia [documents](../protocol/documents.md) use their own CRDT, shaped for signed history and authorship, with the same goal. <!-- id:f7J-xUIM -->
- **git.** The model for [open editing](./open-editing.md): a graph of signed changes, branches you own, and change requests that the owner can merge without granting any rights. <!-- id:IOeMfONx -->

# Neighbours <!-- id:D0711dfD -->

<!-- id:KDohDMDd -->
- **Solid.** Data belongs to people. Apps read it from pods that the user owns. <!-- id:DsfDHIyf -->
- **Nostr.** Signed events published to relays, with identity that is only a key. Nostr broadcasts events through relays. Seed syncs documents. <!-- id:9MASeseU -->
- **Bluesky and the AT Protocol.** Decentralisation that keeps moderation and ease of use in view. <!-- id:AaVH4Of1 -->
- **Freenet and GNUnet.** Decentralisation for hostile conditions, where resisting censorship and keeping privacy come first. <!-- id:b-M0qAO3 -->
- **Usenet.** Discussion passed from server to server with no central authority, and the moderation and governance problems that every later social system inherited. Its `.newsrc` file, which records what you have read, inspired Seed's local read state. <!-- id:TJUJE-9k -->

Peergos, Upspin, p2panda and Willow belong on the same list. <!-- id:xN9f9cpG -->

# See also <!-- id:DLaoHffN -->

- [Why Hypermedia](../why.md) <!-- id:qHI3HFV4 -->
- [The Hypermedia protocol](../protocol.md) <!-- id:24RedlU5 -->
- [Signed content](./signed-content.md) <!-- id:9nwyJdMl -->
- [A network for thought](./network-for-thought.md) <!-- id:enMXc6OG -->
