---
name: Inspirations
summary: The systems Hypermedia borrows from, from Engelbart's NLS and Nelson's Xanadu to IPFS, Secure Scuttlebutt, UCAN and Automerge, in a few lines each.
---
None of the engineering ideas in Hypermedia are new. They were scattered across remarkable systems, and the work of the last five years has been learning how to combine content-addressed storage, CRDTs, hypermedia primitives, peer-to-peer networking, capability-based security and a humane interface into one coherent whole. This page names the sources so you can read them for yourself.

# The vision

- **NLS (Engelbart, 1968).** The oN-Line System demonstrated the mouse, hypertext, shared documents and real-time collaboration decades early. Its goal was augmenting collective intelligence. Seed's private-documents design and its "views" of content trace directly back to NLS viewspecs.
- **Xanadu (Nelson).** A universal hypertext where documents are never copied, only referenced; every quotation stays linked to its source, every author credited, every connection permanent. Hypermedia's fine-grained links, embeds with attribution, and versioned references are Xanadu's ideas made concrete.

# Content addressing and storage

- **IPFS.** Data identified by what it is rather than where it lives. Hypermedia blobs are IPFS blocks in DAG-CBOR, identified by [CID](../cid.md), and files travel as UnixFS. IPFS and libp2p let the team focus on the knowledge layer rather than reinventing networking, and they act as neutral ground where different networks can interoperate.
- **libp2p.** The modular networking stack under IPFS: transports, discovery, encryption, routing as composable parts. The Seed daemon is a libp2p node and serves its peer-to-peer RPCs over it.
- **Perkeep.** Personal data as a lifelong, content-addressed archive of immutable blobs, with applications as views over the data rather than owners of it. The question it asks, what if your data outlived every app, is Hypermedia's question too.
- **DAT and Beaker Browser.** Append-only logs and content addressing for sharing datasets and whole websites from your own machine. Beaker made the web feel writable again; publishing became saving a file.

# Identity and trust

- **Bitcoin.** Decentralised agreement among untrusted participants, and the demonstration that decentralisation can work at scale. Hypermedia takes the key-as-identity idea and none of the consensus machinery. It is explicitly not a blockchain.
- **Keybase.** Cryptographic identity with public proofs of ownership of other accounts and devices, packaged so that people could actually use it. Its fate after acquisition is a reminder that identity becomes fragile when trust recentralises.
- **Secure Scuttlebutt.** Signed append-only logs shared peer to peer, propagated through social graphs rather than algorithms. SSB showed how a web of trust and links can address spam in an open network, and that decentralisation does not have to mean global reach.
- **UCAN.** Capability-based authorisation with signed tokens that delegate scoped permissions from one actor to another. Hypermedia's [capabilities](../capability.md) are certificate capabilities in this family, simpler and tightly scoped to the protocol's needs.
- **Petnames.** The idea that names are local claims rather than global facts. A Hypermedia [contact](../contact.md) is your public claim that you know an account by a certain name.

# Collaboration

- **Automerge.** A CRDT library that lets peers edit shared data independently and merge without conflicts or coordination, making collaboration feel local. Hypermedia documents use their own CRDT, shaped for signed history and attribution, but the goal is the same.
- **git.** The model for open editing: a graph of signed changes, branches you own, and change requests the owner can merge without granting future rights.

# Neighbours

- **Solid.** Data belongs to people, not applications; apps read from user-owned pods.
- **Nostr.** Signed events published to relays, with identity purely cryptographic. In Gabo's words, Nostr is a relay-based event broadcast system while Seed is a document-sync system.
- **Bluesky and the AT Protocol.** Decentralisation that keeps moderation and mainstream usability in view.
- **Freenet and GNUnet.** The adversarial end of decentralisation, where censorship resistance and privacy come first.
- **Usenet.** Store-and-forward discussion without a central authority, and the moderation and governance problems that every later social system inherited. Its `.newsrc` read-state file inspired Seed's local read state.

The team's own essay on this lineage, "We're not alone", is published on seed.hyper.media. Readers there added Peergos, Upspin, p2panda and Willow to the list.

# See also

- [Why Hypermedia](../why.md)
- [The Hypermedia protocol](../protocol.md)
