---
name: "RPC: AccountContacts"
summary: "Returns the contact records an account has written, given that account’s uid."
schemaDefinition: ipfs://bafyreifecpqr2l4wpryx33wvsjjpwjdnz7jofg4mioq2djp2tb2pf7byfa
---
Lists the [contacts](../protocol/permissions.md) an [account](../protocol/identity.md) has written, given that account's uid. Each result is a [contact record](./type/contact-record.md). <!-- id:cWeHZkGM -->

This page describes the **rpc/account-contacts** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:x07vBh1L -->

# Shape <!-- id:iSm7ekda -->

A **closed struct** with these fields: <!-- id:epckzhLV -->
  - `key` _(required)_: `"AccountContacts"` <!-- id:KXx30EJe -->
  - `input` _(required)_: [string](../string.md) <!-- id:6uKQDTTS -->
  - `output` _(required)_: list of [rpc/type/contact-record](./type/contact-record.md) <!-- id:rqQUbF0Q -->

# Depends on <!-- id:RyPlOCvq -->

- [string](../string.md) <!-- id:OUn04mcR -->
- [rpc/type/contact-record](./type/contact-record.md) <!-- id:ETTURl3n -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Contact](../contact.md): the signed blob behind each record.
- [SubjectContacts](./subject-contacts.md): the contacts that name an account.
- [Identity](../protocol/identity.md): accounts and keys.
