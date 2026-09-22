---
name: Authority
summary: A public key that owns and signs everything published under its name.
---
An **authority** is a public key that owns and signs everything published under its name. It is a [principal](./principal.md), the key of an [account](./protocol/identity.md). This library names its authority by domain: the files in the repository write `hm://hyper.media/<name>`. `hm://hyper.media` is a name the [SDK](./build/sdk.md) and the docs sync understand. The network does not resolve domains in `hm://` URLs yet, and support for that is planned. So the sync publishes the library into the space of the key that signs the push, and swaps `hyper.media` for that key in page links and frontmatter. Published documents carry the resolved key. Schema blobs keep `hm://hyper.media` unchanged, so a schema has the same CID wherever the library is published. The library's families are told apart by path: the root and `schema/` hold the Hypermedia Network's concepts and the type language (see [Network blobs](./schema/blobs.md)), and `example/` holds the [examples](./example.md). <!-- id:8jhx0qR- -->

# See also <!-- id:4MlMjiz4 -->

- [Identity](./protocol/identity.md): accounts and keys. <!-- id:CEFg7k_c -->
- [principal](./principal.md): how a public key is encoded. <!-- id:W6J_bENE -->
- [URLs](./protocol/urls.md): `hm://` addresses under an account. <!-- id:sX2LUzdM -->
- [Sites](./protocol/sites.md): how a domain points at an account. <!-- id:NYgZ6CMO -->
- [Hypermedia Schemas](./schema.md): the type language published here. <!-- id:Nc1E7qpO -->
