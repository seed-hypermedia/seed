---
name: Contact Record
summary: "A contact as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences."
---
A [contact](../../protocol/permissions.md) as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences. The signed blob is [contact](../../contact.md). <!-- id:bdxMgVZL -->

This page describes the **rpc/type/contact-record** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:9Af5PJh0 -->

# See also <!-- id:3Pf9mJmb -->

- [Contact](../../contact.md): the signed contact blob. <!-- id:igc-2qQ- -->
- [AccountContacts](../account-contacts.md): contacts an account wrote. <!-- id:XJeRclKn -->
- [SubjectContacts](../subject-contacts.md): contacts that name an account. <!-- id:Rk7NWvBU -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:hoLBK5kk -->
