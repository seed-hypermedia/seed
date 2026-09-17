---
name: "RPC: AccountContacts"
summary: "Returns the contact records an account has written, given that account’s uid."
schemaDefinition: ipfs://bafyreifecpqr2l4wpryx33wvsjjpwjdnz7jofg4mioq2djp2tb2pf7byfa
---
Lists the contacts an account has named. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:cWeHZkGM -->

This page describes the **rpc/account-contacts** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:x07vBh1L -->

# Shape <!-- id:iSm7ekda -->

A **closed struct** with these fields: <!-- id:epckzhLV -->
  - `key` _(required)_ — `"AccountContacts"` <!-- id:KXx30EJe -->
  - `input` _(required)_ — [string](../string.md) <!-- id:6uKQDTTS -->
  - `output` _(required)_ — list of [rpc/type/contact-record](./type/contact-record.md) <!-- id:rqQUbF0Q -->

# Depends on <!-- id:RyPlOCvq -->

- [string](../string.md) <!-- id:OUn04mcR -->
- [rpc/type/contact-record](./type/contact-record.md) <!-- id:ETTURl3n -->
