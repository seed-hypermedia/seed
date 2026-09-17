---
name: The end of broken links
summary: Why Hypermedia names content by a hash of its bytes, and how that lets a community archive and redistribute the things it links to.
---
Old links break. Browse anything written more than a few years ago and many of its references now point at nothing. The web ties every address to a server, and servers move, get sold, run out of money, or outlive their owners. Knowledge that spans many sites decays by default.

Hypermedia starts somewhere else. A document's history is a set of signed pieces of data, and each piece is named by a hash of its own bytes. Anyone who holds those bytes can serve them. Anyone who receives them can check that they are exactly what the author signed.

# Link rot is a protocol problem

A web address, a URL, names a location. The content at that location can change or vanish, and the address gives you no way to tell. Archives such as the Wayback Machine work around this from the outside. They are trusted third parties that copy what they can reach, when they can reach it.

Hypermedia addresses differ in two ways. First, a document's address, an [hm:// URL](../protocol/urls.md), names an [account](../protocol/identity.md) and a path. The account is a public key, and no hostname appears in the address. Second, the data behind the address is a chain of [changes](../change.md). Each change is stored as an immutable [blob](../blob.md) named by its [CID](../cid.md), a content hash. Add a [version](../protocol/documents.md) to the URL and it names one exact state of the document forever.

The address is a key and the data is content-addressed, so the document does not depend on any one server. The author's own node has it. A [site](../protocol/sites.md) that publishes it has it. Every reader who opened it has a copy in their node. If the author's site goes offline, the document is still there for anyone who saved it, and it can still be verified.

# Archival as a community act

When you reference something on the Hypermedia network, your node is encouraged to download and keep the source data. That keeps your reference working. If the destination is offline or will not share, you can redistribute what you hold. Your readers check the signatures and content hashes, so they do not have to trust you.

So archival becomes something a community does by default, where today a few institutions do it. Content that many people link becomes permanent in practice, because many nodes hold it. The team is blunt about the limit: the only way to guarantee permanence is to save it yourself. Nothing in the protocol forces anyone else to host your data.

# What ships today

- Every signed blob carries its own signature and is fetched by CID, so its integrity does not depend on the [peer](../protocol/network.md) that delivered it. See [Integrity](../protocol/integrity.md).
- A node keeps what it has synced. Sync is scoped: your node fetches the sites you joined, the material they link, and the [comments](../protocol/comments.md) on them. It does not fetch everything it hears about. See [Network](../protocol/network.md).
- Versioned links, `?v=` in the URL, name an exact set of change heads, so a citation cannot drift under you. See [Documents](../protocol/documents.md).
- Files and media travel as IPFS blocks, fetched through any node's [gateway](../protocol/sites.md). See [Files](../protocol/files.md).

# What is still direction

Each node chooses what to keep. There is no protocol-level pinning agreement, no incentive layer, and no guarantee that a peer will keep serving a blob. The team's stated design is that nodes choose what to broadcast, what to block, and what to archive without distributing. Content that is linked often becomes permanent in effect because many nodes copy it. No rule makes it permanent.

# See also

- [Signed content, not server trust](./signed-content.md)
- [Open editing](./open-editing.md)
- [A network for thought](./network-for-thought.md)
- [Blobs](../protocol/blobs.md) and [CID](../cid.md)
- [URLs](../protocol/urls.md)
- [Integrity](../protocol/integrity.md)
