---
name: Authority
summary: An authority is the public key that owns an hm:// address and signs everything published under it.
---
An **authority** is the public key that owns an address. It signs everything published under its name. It is a [principal](./principal.md), the key of an [account](./protocol/identity.md). In an [`hm://` URL](./protocol/urls.md), the authority is the part right after `hm://`. The path after it names a [document](./protocol/documents.md) in that key's [space](./protocol/spaces.md).

The network pages use the word in a second way. They call the site server of a space its authority, meaning the first peer to ask about that space. See [Network](./protocol/network.md).

The [Hypermedia Schemas](./schema.md) library names its authority by domain: its schemas write `hm://hyper.media/<name>`. The [SDK](./build/sdk.md) and the docs sync know which key `hyper.media` stands for. The peer-to-peer network does not look up domain names. A published document carries the key of the space it is published in. A schema [blob](./protocol/blobs.md) keeps `hm://hyper.media` unchanged, so a schema has the same [CID](./cid.md) wherever the library is published. [References and naming](./schema/references.md#Mk1UgX6F) has the details. <!-- id:8jhx0qR- -->

# See also <!-- id:4MlMjiz4 -->

- [Identity](./protocol/identity.md): accounts and keys. <!-- id:CEFg7k_c -->
- [principal](./principal.md): how a public key is encoded. <!-- id:W6J_bENE -->
- [URLs](./protocol/urls.md): `hm://` addresses under an account. <!-- id:sX2LUzdM -->
- [Sites](./protocol/sites.md): how a domain points at an account. <!-- id:NYgZ6CMO -->
- [References and naming](./schema/references.md): names, CIDs and the library's `hm://hyper.media` name. <!-- id:Nc1E7qpO -->
