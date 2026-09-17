---
name: The end of broken links
summary: Why Hypermedia addresses content by what it is rather than where it lives, and how that lets a community archive and redistribute the things it links to.
---
Old links break. Browse anything written more than a few years ago and a good share of its references now point at nothing. The web ties every address to a server, and servers move, get sold, run out of money, or outlive their owners. Cross-site knowledge degrades by default.

Hypermedia takes a different starting point: a document's history is a set of signed pieces of data, each identified by a hash of its own bytes. Anyone who holds those bytes can serve them, and anyone who receives them can check that they are exactly what the author signed.

# Link rot is a protocol problem

The web's address, a URL, names a location. The content at that location can change or vanish, and the address gives you no way to tell. Archives such as the Wayback Machine mitigate this from the outside, by being a trusted third party that copies what it can reach, when it can reach it.

Hypermedia addresses are different in two ways. A document's address, an [hm:// URL](../protocol/urls.md), names an [account](../glossary.md) and a path, and the account is a public key, not a hostname. And the data behind the address is a chain of [changes](../change.md), each stored as an immutable [blob](../blob.md) identified by its [CID](../cid.md), a content hash. Add a version to the URL and it names an exact state of the document forever.

Because the address is a key and the data is content-addressed, the document does not depend on any one server. The author's own node has it. A site that publishes it has it. Every reader who opened it has a copy in their node. If the author's site goes offline, the document is still there for anyone who saved it, and still verifiable.

# Archival as a community act

When you reference something on the Hypermedia network, your node is encouraged to download and keep the source data. That is what makes your reference robust: if the destination is offline or unwilling to share, you can redistribute what you hold, and your readers can validate it by checking signatures and content hashes rather than trusting you.

This turns archival from a job for a small number of institutions into something a community does by default. Content that many people link becomes, in practice, permanent, because many nodes hold it. The flip side is stated plainly by the team: the only way to guarantee permanence is to save it yourself. Nothing in the protocol forces anyone else to host your data.

# What ships today

- Every signed blob on the network carries its own signature and is fetched by CID, so integrity does not depend on the peer that delivered it. See [Integrity](../protocol/integrity.md).
- A node keeps what it has synced. Sync is scoped: your node fetches the sites you joined, the material they link, and the comments on them, not everything it hears about. See [Network](../protocol/network.md).
- Versioned links, `?v=` in the URL, name an exact set of change heads, so a citation cannot drift under you. See [Documents](../protocol/documents.md).
- Files and media travel as IPFS blocks, fetched through any node's gateway. See [Files](../protocol/files.md).

# What is still direction

Retention policy is a node's own choice. There is no protocol-level pinning agreement, no incentive layer, and no guarantee that a peer will keep serving a blob. The team's stated design is that nodes choose what to broadcast, what to block, and what to archive without distributing, and that frequently linked content becomes effectively permanent through replication rather than through a rule.

# See also

- [Signed content, not server trust](./signed-content.md)
- [Blobs](../protocol/blobs.md) and [CID](../cid.md)
- [Version history and branching](./open-editing.md)
