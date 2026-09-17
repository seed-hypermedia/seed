---
name: Inspirations
summary: The systems Hypermedia borrows from, from Engelbart's NLS and Nelson's Xanadu to IPFS, Secure Scuttlebutt, UCAN and Automerge, in a few lines each.
---
None of the engineering ideas in Hypermedia are new. They were spread across many earlier systems. The work of the last five years has been learning to combine content-addressed storage, CRDTs, hypermedia primitives, peer-to-peer networking, capability-based security and a humane interface into one coherent system. This page names the sources so you can read them yourself.

# The vision

- **NLS (Engelbart, 1968).** The oN-Line System showed the mouse, hypertext, shared documents and real-time collaboration decades early. Its goal was to augment collective intelligence. Seed's [private documents](../protocol/privacy.md) design and its [views](../protocol/urls.md) of content trace directly back to NLS viewspecs.
- **Xanadu (Nelson).** A universal hypertext where documents are never copied, only referenced. Every quotation stays linked to its source, every author is credited, and every connection is permanent. Hypermedia's fine-grained links, [embeds](../protocol/blocks.md) with attribution, and versioned references put Xanadu's ideas into practice.

# Content addressing and storage

- **IPFS.** Data named by a hash of its content. Hypermedia [blobs](../protocol/blobs.md) are IPFS blocks in DAG-CBOR, named by [CID](../cid.md), and [files](../protocol/files.md) travel as UnixFS. IPFS and libp2p let the team work on the knowledge layer without building its own networking. They also act as neutral ground where different networks can interoperate.
- **libp2p.** The modular networking stack under IPFS, with transports, discovery, encryption and routing as composable parts. The [Seed daemon](../apps/daemon.md) is a libp2p node and serves its [peer-to-peer](../protocol/network.md) RPCs over it.
- **Perkeep.** Personal data as a lifelong, content-addressed archive of immutable blobs. Applications are views over the data and do not own it. Perkeep asks what happens when your data outlives every app, and Hypermedia asks the same question.
- **DAT and Beaker Browser.** Append-only logs and content addressing for sharing datasets and whole websites from your own machine. Beaker made the web feel writable again: publishing became saving a file.

# Identity and trust

- **Bitcoin.** Decentralised agreement among untrusted participants, and proof that decentralisation can work at scale. Hypermedia takes the idea of a [key as identity](../protocol/identity.md) and none of the consensus machinery. It is explicitly not a blockchain.
- **Keybase.** Cryptographic identity with public proofs that you own other accounts and devices, packaged so that people could actually use it. Its fate after acquisition is a reminder that identity becomes fragile when trust recentralises.
- **Secure Scuttlebutt.** Signed append-only logs shared peer to peer, spread through social graphs with no ranking algorithm. SSB showed how a web of trust and links can address spam in an open network. It also showed that a decentralised network does not need global reach.
- **UCAN.** Capability-based authorisation with signed tokens that delegate scoped permissions from one actor to another. Hypermedia's [capabilities](../capability.md) are certificate capabilities in this family, simpler and scoped tightly to what the protocol needs. See [Permissions](../protocol/permissions.md).
- **Petnames.** Names are local claims, and no global registry backs them. A Hypermedia [contact](../contact.md) is your public claim that you know an account by a certain name.

# Collaboration

- **Automerge.** A CRDT library that lets peers edit shared data independently and merge without conflicts or coordination, so collaboration feels local. Hypermedia [documents](../protocol/documents.md) use their own CRDT, shaped for signed history and attribution, with the same goal.
- **git.** The model for [open editing](./open-editing.md): a graph of signed changes, branches you own, and change requests the owner can merge without granting future rights.

# Neighbours

- **Solid.** Data belongs to people. Apps read it from pods the user owns.
- **Nostr.** Signed events published to relays, with a purely cryptographic identity. In Gabo's words, Nostr is a relay-based event broadcast system and Seed is a document-sync system.
- **Bluesky and the AT Protocol.** Decentralisation that keeps moderation and mainstream usability in view.
- **Freenet and GNUnet.** The adversarial end of decentralisation, where censorship resistance and privacy come first.
- **Usenet.** Store-and-forward discussion with no central authority, and the moderation and governance problems that every later social system inherited. Its `.newsrc` read-state file inspired Seed's local read state.

The team's own essay on this lineage, "We're not alone", is published on seed.hyper.media. Readers there added Peergos, Upspin, p2panda and Willow to the list.

# See also

- [Why Hypermedia](../why.md)
- [The Hypermedia protocol](../protocol.md)
- [Signed content, not server trust](./signed-content.md)
- [A network for thought](./network-for-thought.md)
- [Permissions prior art](../history/permissions/prior-art.md)
