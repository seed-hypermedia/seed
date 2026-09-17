---
name: Contact Record
summary: "A contact as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences."
schemaDefinition: ipfs://bafyreidqyisjyfgc6qsvvdgtbcmcpswwyxuuehoazf5tcmf27huile42zu
---
A [contact](../../protocol/permissions.md) as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences. The signed blob is [contact](../../contact.md). <!-- id:bdxMgVZL -->

This page describes the **rpc/type/contact-record** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:9Af5PJh0 -->

# Shape <!-- id:OPcW0q1Y -->

A **closed struct** with these fields: <!-- id:ugdqxq2C -->
  - `id` _(required)_: [string](../../string.md) <!-- id:aqCipWke -->
  - `subject` _(required)_: [string](../../string.md) <!-- id:bMulhxTe -->
  - `name` _(required)_: [string](../../string.md) <!-- id:KYAzDSpX -->
  - `account` _(required)_: [string](../../string.md) <!-- id:mkd9FU0y -->
  - `signer` _(required)_: [string](../../string.md) <!-- id:ayR30qBL -->
  - `createTime`: [timestamp](../../timestamp.md) <!-- id:oIDm5uXY -->
  - `updateTime`: [timestamp](../../timestamp.md) <!-- id:onjq-D5J -->
  - `subscribe`: [contact/subscribe](../../contact/subscribe.md) <!-- id:sD_jerc- -->

# Depends on <!-- id:1vh3aSIz -->

- [contact/subscribe](../../contact/subscribe.md) <!-- id:iqkqluZP -->
- [timestamp](../../timestamp.md) <!-- id:CYoLI_wb -->
- [string](../../string.md) <!-- id:gMda6qOD -->

# See also

- [Contact](../../contact.md): the signed contact blob.
- [AccountContacts](../account-contacts.md): contacts an account wrote.
- [SubjectContacts](../subject-contacts.md): contacts that name an account.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
