---
name: Account
summary: "A reference to an account, held as the bare `hm://<principal>` URL, with `format: hm-profile` so editors offer an account search and accept a pasted principal."
---
This page describes the **account** value type of [Hypermedia Schemas](./schema.md). It is a field type for the attributes of a [document](./protocol/documents.md), and it holds a reference to an account. It is not the account concept. To learn what an account is, read [Identity](./protocol/identity.md). The formal schema of this type is attached to this document as the `schemaDefinition` key of its metadata. So the app can show the schema and create values of this type. <!-- id:wS6VcROX -->

An **account** value names a person, an organisation or a device by its [principal](./principal.md). That is the public key that owns the [space](./protocol/spaces.md) `hm://<principal>/…`. The type refines [string](./string.md): the value is the account's bare [`hm://` URL](./hm-url.md) with no path. So the same spelling works anywhere a document reference does, and it leads to the account's [home document](./protocol/spaces.md). A [principal](./principal.md) holds the same key as bytes inside a signed [blob](./protocol/blobs.md). An account holds it as text inside document attributes. <!-- id:4jNfljFw -->

`format: hm-profile` tells an editor two things. Show the value as a pill with the account's name. Offer a search over accounts when the field is empty. You can paste either spelling: on commit, a `z6Mk…` principal becomes `hm://z6Mk…`. The pattern lets a validator check the shape without looking anything up. <!-- id:ArwUejx- -->

# See also <!-- id:aVpJC9ch -->

- [principal](./principal.md): the same key as bytes, for signed blobs. <!-- id:KGAeXFEf -->
- [hm-url](./hm-url.md): a reference to any document, with an optional `target` type. <!-- id:c2GsdpRs -->
- [Identity](./protocol/identity.md): how keys become accounts. <!-- id:cEE7AS8g -->
- [Scalar schema](./schema/scalar-schema.md): how `format` and patterns refine a string. <!-- id:hMVGFcLs -->
