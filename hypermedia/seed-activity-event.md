---
name: Activity event
summary: "One event of the activity feed. The event union is not yet pinned down schema-side, so this is an open map — tightening it is tracked follow-up work. A derived "
schemaDefinition: ipfs://bafyreifik2q7ldy2qoy7v6brxriztcni5es4jjbrimqbigbdbd643b744i
---
One event of the activity feed. The event union is not yet pinned down schema-side, so this is an open map — tightening it is tracked follow-up work. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ohvGePiV -->

This document describes the **seed-activity-event** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ZYDbAobO -->