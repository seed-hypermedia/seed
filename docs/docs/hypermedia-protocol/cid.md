# Content-Addressed Identifiers

A CID is the addressability technique to access a file/blob of data in the [IPFS](./ipfs.md) ecosystem and Hypermedia Protocol.. Each file/blob is addressed with a CID, which is a hash of the content.

Because each file is addressed by it's hash, you don't need to trust the peer who sends you the data. Once you receive the data you can check the hash, verify it matches the expected CID, and otherwise discard it. If the CID doesn't match, the peer who gave it to you made a mistake or is behaving poorly. (You can then try again, or disconnect from this peer.)

This technique of addressing a chunk of content with its hash is called "content addressability", which is the foundational feature of IPFS and differentiates CIDs from regular IDs.