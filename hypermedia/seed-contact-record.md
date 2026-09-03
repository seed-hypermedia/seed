---
name: Contact record
summary: "A contact as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences. A derived read model computed by the Se"
schemaDefinition: ipfs://bafyreifsahtt5kmdezrng2lan62yqtrjtjt5dzskzizowegcln3nocvinm
---
A contact as the API returns it: who named whom what, signed by which key, with timestamps and subscription preferences. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:bdxMgVZL -->

This document describes the **seed-contact-record** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:9Af5PJh0 -->

# Shape <!-- id:OPcW0q1Y -->

A **closed struct** with these fields: <!-- id:ugdqxq2C -->
  - `id` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:aqCipWke -->
  - `subject` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:bMulhxTe -->
  - `name` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:KYAzDSpX -->
  - `account` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:mkd9FU0y -->
  - `signer` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:ayR30qBL -->
  - `createTime` — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:oIDm5uXY -->
  - `updateTime` — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:onjq-D5J -->
  - `subscribe` — [hypermedia-contact-subscribe](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-contact-subscribe) <!-- id:sD_jerc- -->

# Depends on <!-- id:1vh3aSIz -->

- [hypermedia-contact-subscribe](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-contact-subscribe) <!-- id:iqkqluZP -->
- [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:CYoLI_wb -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:gMda6qOD -->
