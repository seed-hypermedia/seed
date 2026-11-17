---
name: Authority
summary: A public key that owns and signs everything published under its name.
---
An **authority** is a public key that owns and signs everything published under its name. It is a [principal](./principal.md), the key of an [account](./protocol/identity.md). In an [`hm://` URL](./protocol/urls.md) the authority is the part after `hm://`, and the path names a document under it.

The [Hypermedia Schemas](./schema.md) library names its authority by domain: its schemas write `hm://hyper.media/<name>`. That is a name the [SDK](./build/sdk.md) and the docs sync resolve, and the network does not resolve domains. Published documents carry the key of the space they are published in, and schema blobs keep `hm://hyper.media` unchanged, so a schema has the same CID wherever the library is published. [References and naming](./schema/references.md#Mk1UgX6F) has the details. <!-- id:8jhx0qR- -->

# See also <!-- id:4MlMjiz4 -->

- [Identity](./protocol/identity.md): accounts and keys. <!-- id:CEFg7k_c -->
- [principal](./principal.md): how a public key is encoded. <!-- id:W6J_bENE -->
- [URLs](./protocol/urls.md): `hm://` addresses under an account. <!-- id:sX2LUzdM -->
- [Sites](./protocol/sites.md): how a domain points at an account. <!-- id:NYgZ6CMO -->
- [References and naming](./schema/references.md): names, CIDs and the library's `hm://hyper.media` name. <!-- id:Nc1E7qpO -->
