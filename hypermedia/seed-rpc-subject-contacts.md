---
name: "RPC: SubjectContacts"
summary: "Lists the contact records that name a subject. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pa"
schemaDefinition: ipfs://bafyreigembd34vdvwu72x73ih2mvvipvdk4kayy6txlzregaugjoxqie6a
---
Lists the contact records that name a subject. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:pML1FZCM -->

This document describes the **seed-rpc-subject-contacts** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Rxkn_YDl -->

# Shape <!-- id:JV-ZFvxY -->
A **closed struct** with these fields: <!-- id:TWMScgo6 -->
  - `key` _(required)_ — `string` enum: `SubjectContacts` <!-- id:-1wXTkPY -->
  - `input` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:R9qGvh5m -->
  - `output` _(required)_ — list of [seed-contact-record](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-contact-record) <!-- id:eCIUnOxN -->

# Depends on <!-- id:IiL36UeS -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:5-UmYe9_ -->
- [seed-contact-record](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-contact-record) <!-- id:G6s5kROB -->