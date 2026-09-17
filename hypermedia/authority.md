---
name: Authority
summary: "A public key that owns and signs everything published under its name."
---
An **authority** is a public key that owns and signs everything published under its name. It is a [principal](./principal.md), the key of an [account](./protocol/identity.md). A domain like `hyper.media` resolves to one. This library is published under one authority, the Hypermedia account (`hm://z6MkmZUb…/*`). Its families are told apart by path: the root and `schema/` hold the Hypermedia Network's concepts and the type language (see [Network blobs](./schema/blobs.md)), `rpc/` holds the [Seed API](./build/web-api.md)'s [read models](./rpc.md), and `example/` holds the [examples](./example.md). <!-- id:8jhx0qR- -->

# See also

- [Identity](./protocol/identity.md): accounts and keys.
- [principal](./principal.md): how a public key is encoded.
- [URLs](./protocol/urls.md): `hm://` addresses under an account.
- [Sites](./protocol/sites.md): how a domain points at an account.
- [Hypermedia Schemas](./schema.md): the type language published here.
