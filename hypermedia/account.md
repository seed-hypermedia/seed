---
name: Account
summary: "A reference to an account, held as the bare `hm://<principal>` URL, with `format: hm-profile` so editors offer an account search and accept a pasted principal."
---
An **account** value names a person, an organisation or a device by its [principal](./principal.md), the public key that owns the space `hm://<principal>/…`. It refines [string](./string.md): the value is the account's bare [`hm://` URL](./hm-url.md) with no path, so the same spelling works anywhere a document reference does and resolves to the account's home document. A [principal](./principal.md) holds the same key as bytes inside signed blobs; an account holds it as text inside document attributes. <!-- id:4jNfljFw -->

`format: hm-profile` tells an editor to render the value as a pill showing the account's name and to offer a search over accounts when the field is empty. Pasting either spelling works: a `z6Mk…` principal is normalised to `hm://z6Mk…` on commit, and the pattern lets a validator check the shape without resolving anything. <!-- id:ArwUejx- -->

This page describes the **account** type, a value type of [Hypermedia Schemas](./schema.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:wS6VcROX -->

# See also <!-- id:aVpJC9ch -->

- [principal](./principal.md): the same key as bytes, for signed blobs. <!-- id:KGAeXFEf -->
- [hm-url](./hm-url.md): a reference to any document, with an optional `target` type. <!-- id:c2GsdpRs -->
- [Identity](./protocol/identity.md): how keys become accounts. <!-- id:cEE7AS8g -->
- [Scalar schema](./schema/scalar-schema.md): how `format` and patterns refine a string. <!-- id:hMVGFcLs -->
