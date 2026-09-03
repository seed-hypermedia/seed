---
name: "Resource: comment"
summary: A resolved resource that is a comment. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreihf5quu23cdex5rrswrlx5pspwl5765mfi7n7x5crdxtbh7dv4biu
---
This document describes the **seed-resource-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:WM00tRcd -->

# Shape <!-- id:EAMFXFtn -->

A **closed struct** with these fields: <!-- id:CTozbhjz -->
  - `type` _(required)_ — `string` enum: `comment` <!-- id:ZLI-MfCl -->
  - `id` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:UInd1qiG -->
  - `comment` _(required)_ — [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:YUJFaUl6 -->

# Depends on <!-- id:Mg_oNLnv -->

- [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:LtTxleFu -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:ExCrWOlT -->
