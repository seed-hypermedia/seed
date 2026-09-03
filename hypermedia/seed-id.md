---
name: Hypermedia ID (parsed)
summary: "A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carr"
schemaDefinition: ipfs://bafyreic4b4o36yhhu6rcezh37aexajxipoucpgthsrt6cbvpgvkcblipua
---
A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carry are null. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:_G2YLDZ8 -->

This document describes the **seed-id** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XTZhL1KF -->

# Shape <!-- id:dv0g4WNA -->

A **closed struct** with these fields: <!-- id:fh7Sxe0r -->
  - `id` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:fskPAU7S -->
  - `uid` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:XfHXweTr -->
  - `path` _(required)_ — one of list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:B8EHAbPu -->
  - `version` _(required)_ — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:pib8La4i -->
  - `blockRef` _(required)_ — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:ZNfUNSa6 -->
  - `blockRange` _(required)_ — one of [seed-block-range](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-block-range) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:g9HesrHj -->
  - `hostname` _(required)_ — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:-103U5pY -->
  - `scheme` _(required)_ — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:RXYVaFte -->
  - `latest` — one of [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:Nxnyb22b -->

# Depends on <!-- id:gwqKPqVh -->

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:yqoRG8aN -->
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:Wl4BhCsF -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:n_YOHrze -->
- [seed-block-range](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-block-range) <!-- id:dTVQ_nVA -->
