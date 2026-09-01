---
name: "Accounts metadata"
summary: "Account uid -> resolved metadata payload, sent alongside listings so clients can render authors without extra requests. A derived read model computed by the See"
---

# Accounts metadata

Account uid -> resolved metadata payload, sent alongside listings so clients can render authors without extra requests. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-accounts-metadata** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

An **open map** — every value: [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload).

## Depends on

- [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload)
