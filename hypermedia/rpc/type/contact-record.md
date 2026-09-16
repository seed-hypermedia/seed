---
name: Contact Record
summary: "A contact as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences. A derived read model computed by the Se"
schemaDefinition: ipfs://bafyreidqyisjyfgc6qsvvdgtbcmcpswwyxuuehoazf5tcmf27huile42zu
---
A contact as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:bdxMgVZL -->

This document describes the **rpc/type/contact-record** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:9Af5PJh0 -->

# Shape <!-- id:OPcW0q1Y -->

A **closed struct** with these fields: <!-- id:ugdqxq2C -->
  - `id` _(required)_ — [string](../../string.md) <!-- id:aqCipWke -->
  - `subject` _(required)_ — [string](../../string.md) <!-- id:bMulhxTe -->
  - `name` _(required)_ — [string](../../string.md) <!-- id:KYAzDSpX -->
  - `account` _(required)_ — [string](../../string.md) <!-- id:mkd9FU0y -->
  - `signer` _(required)_ — [string](../../string.md) <!-- id:ayR30qBL -->
  - `createTime` — [timestamp](../../timestamp.md) <!-- id:oIDm5uXY -->
  - `updateTime` — [timestamp](../../timestamp.md) <!-- id:onjq-D5J -->
  - `subscribe` — [contact/subscribe](../../contact/subscribe.md) <!-- id:sD_jerc- -->

# Depends on <!-- id:1vh3aSIz -->

- [contact/subscribe](../../contact/subscribe.md) <!-- id:iqkqluZP -->
- [timestamp](../../timestamp.md) <!-- id:CYoLI_wb -->
- [string](../../string.md) <!-- id:gMda6qOD -->
