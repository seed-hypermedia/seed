---
name: The end of broken links
summary: Hypermedia names content by a hash of its bytes, so a link keeps working as long as anyone holds a copy, and a community can keep what it links to.
---
Old links break. Read anything written more than a few years ago, and many of its links lead nowhere. The web ties every address to a server. Servers move, get sold, run out of money, or outlive their owners. So knowledge that spans many sites slowly falls apart. <!-- id:4Aq3UJfx -->

Hypermedia works differently. A document's history is a set of signed pieces of data. Each piece is named by a hash, which is a short fingerprint computed from its own bytes. Anyone who holds those bytes can serve them. Anyone who receives them can check that they are exactly what the author signed. <!-- id:5oY5zGxU -->

# Link rot is a protocol problem <!-- id:sfaEFuJ- -->

A web address names a place. The content at that place can change or vanish, and the address cannot tell you. Archives such as the Wayback Machine work around this from the outside. They copy what they can reach, when they can reach it, and you have to trust them. <!-- id:BcOEwRb6 -->

Hypermedia addresses differ in two ways. <!-- id:TOjaOR8X -->

- The address of a document, an [hm:// URL](../protocol/urls.md), names an [account](../protocol/identity.md) and a path. The account is a public key. No server name appears in the address.
- The data behind the address is a chain of [changes](../change.md). Each change is a [blob](../protocol/blobs.md), a piece of data that never changes, named by its [CID](../cid.md), a content hash. Add a [version](../protocol/documents.md) to the URL, and it names one exact state of the document forever.

So the document does not depend on any one server. The author's own computer has it. A [site](../protocol/sites.md) that publishes it has it. Every reader who opened it in the [Seed app](../software/desktop.md) has a copy. If the author's site goes offline, anyone who saved the document still has it, and anyone can still verify it. <!-- id:Bf-qy4KW -->

# Archiving is something a community does <!-- id:24CfeN5P -->

When you link to something on the Hypermedia network, your node downloads the source data and keeps it. A node is a computer that runs Seed. That keeps your link working. If the original site is offline or will not share, you can pass on what you hold. Your readers check the signatures and the hashes, so they do not have to trust you. <!-- id:BrKLWx1k -->

So a community archives by default, where on the web a few institutions do it. Content that many people link to stays available, because many nodes hold it. The limit is plain: the only way to be sure something lasts is to save it yourself. Nothing in the protocol makes anyone else host your data. <!-- id:UNDT6Tav -->

# Limits <!-- id:G-kzTMNL -->

- Each node chooses what to keep, what to share and what to refuse.
- A node does not fetch everything it hears about. It fetches the sites it joined, the material they link, and the [comments](../protocol/comments.md) on them.
- Nobody promises to keep your data, and nobody is paid to. A [peer](../protocol/network.md) may stop serving a blob at any time.
- Content that is linked often lasts in practice, because many nodes copy it. No rule makes it permanent.

# See also <!-- id:ju5OzHnh -->

- [Signed content](./signed-content.md) <!-- id:61SISE7_ -->
- [Open editing](./open-editing.md) <!-- id:b88qnydx -->
- [A network for thought](./network-for-thought.md) <!-- id:n6piaWsZ -->
- [Blobs](../protocol/blobs.md) and [CID](../cid.md) <!-- id:KDmeIHO8 -->
- [URLs](../protocol/urls.md) <!-- id:H0_RiqrA -->
- [Integrity](../protocol/integrity.md) <!-- id:p58fLxe- -->
- [Network](../protocol/network.md) and [Files](../protocol/files.md)
