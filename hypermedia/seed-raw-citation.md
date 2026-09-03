---
name: Raw citation
summary: A citation in raw indexed form, before client-side resolution into a seed-citation. A derived read model computed by the Seed daemon/API for clients — not a sig
schemaDefinition: ipfs://bafyreiexdcg3sufr655na4iletw2sykxx3q3bk3v5yrqy6it66amj2xpsy
---
A citation in raw indexed form, before client-side resolution into a seed-citation. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ax5Fn9Xm -->

This document describes the **seed-raw-citation** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Wy3Bfu0Z -->

# Shape <!-- id:Qooxep7h -->
A **closed struct** with these fields: <!-- id:VSMoMOwV -->
  - `source` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:xbMuwlRc -->
  - `sourceType` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:QCGc8Mib -->
  - `sourceContext` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:EB2X99HS -->
  - `sourceBlob` — map { 3 fields } <!-- id:HWqmQC6t -->
  - `sourceDocument` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:tGPuH7j_ -->
  - `target` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:mcQ_zF31 -->
  - `targetVersion` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:9r6v5-Jt -->
  - `targetFragment` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:ETitOUBu -->
  - `isExactVersion` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:JjU7xHVn -->
  - `targetBlockRevision` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:5F30tb_v -->
  - `mentionType` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:wQ9hjuTI -->
  - `isExact` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:PmdMfCaq -->

# Depends on <!-- id:dPIrJcel -->
- [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:hBJ55G_b -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:lRrCLPEF -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Z4_aA0VM -->