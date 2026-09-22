---
name: "RPC: AccountContacts"
summary: Returns the contact records an account has written, given that account’s uid.
---
Lists the [contacts](../protocol/permissions.md) an [account](../protocol/identity.md) has written, given that account's uid. Each result is a [contact record](./type/contact-record.md). <!-- id:cWeHZkGM -->

This page describes the **rpc/account-contacts** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:x07vBh1L -->

# See also <!-- id:uhikYCUn -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:Taem6ZY1 -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:QKtlHrQ4 -->
- [RPC](./method.md): every method in one union. <!-- id:cTWIOL1U -->
- [Contact](../contact.md): the signed blob behind each record. <!-- id:Ew7JipJQ -->
- [SubjectContacts](./subject-contacts.md): the contacts that name an account. <!-- id:_vVlhZiV -->
- [Identity](../protocol/identity.md): accounts and keys. <!-- id:NchIw64q -->
