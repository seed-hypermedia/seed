---
name: "RPC: AccountContacts"
summary: "Lists the contacts an account has named. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `o"
schemaDefinition: ipfs://bafyreigrejrheo5fxwrmm3on7jh665jbxokbc5zjr3rpdy7taftyll4wra
---
Lists the contacts an account has named. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:cWeHZkGM -->

This document describes the **seed-rpc-account-contacts** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:x07vBh1L -->

# Shape <!-- id:iSm7ekda -->

A **closed struct** with these fields: <!-- id:epckzhLV -->
  - `key` _(required)_ — `string` enum: `AccountContacts` <!-- id:KXx30EJe -->
  - `input` _(required)_ — [string](./onyx-string.md) <!-- id:6uKQDTTS -->
  - `output` _(required)_ — list of [seed-contact-record](./seed-contact-record.md) <!-- id:rqQUbF0Q -->

# Depends on <!-- id:RyPlOCvq -->

- [string](./onyx-string.md) <!-- id:OUn04mcR -->
- [seed-contact-record](./seed-contact-record.md) <!-- id:ETTURl3n -->
