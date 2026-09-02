---
name: Hypermedia ID (parsed)
summary: "A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carr"
schemaDefinition: ipfs://bafyreic4b4o36yhhu6rcezh37aexajxipoucpgthsrt6cbvpgvkcblipua
---
A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carry are null. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:_G2YLDZ8 -->

This document describes the **seed-id** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XTZhL1KF -->