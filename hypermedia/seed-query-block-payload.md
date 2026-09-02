---
name: Query block payload
summary: "Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/A"
schemaDefinition: ipfs://bafyreib3rfq747lruyqbb6zurdk5dom5watblahbgzfiqwutjwzvfuxtuq
---
Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:VzSZH5xA -->

This document describes the **seed-query-block-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:OsEQqtxV -->