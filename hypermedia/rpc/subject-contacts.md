---
name: "RPC: SubjectContacts"
summary: "Returns the contact records that name a subject account, given the subject’s uid."
schemaDefinition: ipfs://bafyreiav3wpzqh4uzm6wrex7iyeymuahddpbpnpw6q2mzvkdcrkqomcc7i
---
Lists the [contact](../protocol/permissions.md) records that name a subject [account](../protocol/identity.md), given the subject's uid. Each result is a [contact record](./type/contact-record.md). <!-- id:pML1FZCM -->

This page describes the **rpc/subject-contacts** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:Rxkn_YDl -->

# Shape <!-- id:JV-ZFvxY -->

A **closed struct** with these fields: <!-- id:TWMScgo6 -->
  - `key` _(required)_: `"SubjectContacts"` <!-- id:-1wXTkPY -->
  - `input` _(required)_: [string](../string.md) <!-- id:R9qGvh5m -->
  - `output` _(required)_: list of [rpc/type/contact-record](./type/contact-record.md) <!-- id:eCIUnOxN -->

# Depends on <!-- id:IiL36UeS -->

- [string](../string.md) <!-- id:5-UmYe9_ -->
- [rpc/type/contact-record](./type/contact-record.md) <!-- id:G6s5kROB -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Contact](../contact.md): the signed blob behind each record.
- [AccountContacts](./account-contacts.md): the contacts an account has written.
