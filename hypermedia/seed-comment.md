---
name: Comment (payload)
summary: "A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A d"
schemaDefinition: ipfs://bafyreicgtyav5a2qlbgi4langlz5tjsxk3qhfqgv2pyt6c5nxzwgi53ok4
---
A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:3cDEwf1- -->

This document describes the **seed-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:dubklf6x -->

# Shape <!-- id:IaBONBBP -->

A **closed struct** with these fields: <!-- id:hxnNqONe -->
  - `id` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:dcjQthm9 -->
  - `version` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:J4LrGM2E -->
  - `author` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:7mfVIRZU -->
  - `targetAccount` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:yJYYXSde -->
  - `targetPath` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:-8lj6kOw -->
  - `targetVersion` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:UAjhTGkE -->
  - `replyParent` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:c-uNOGGX -->
  - `replyParentVersion` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:UG5_yEyk -->
  - `threadRoot` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:asBCWS_Y -->
  - `threadRootVersion` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:fnFZa1Wa -->
  - `capability` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Th6VPgwz -->
  - `content` _(required)_ — list of [hypermedia-block-node](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-node) <!-- id:kMrq60w0 -->
  - `createTime` _(required)_ — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:GVdcv7Mp -->
  - `updateTime` _(required)_ — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:B3HL3IYi -->
  - `visibility` _(required)_ — [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:QGBLQ-HM -->

# Depends on <!-- id:Wb9fPfnU -->

- [hypermedia-block-node](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-node) <!-- id:bsiLyW0f -->
- [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:c1mHO1av -->
- [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:cKpRsaIH -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:KfWsCcfr -->
