---
name: Parsed fragment
summary: A parsed URL fragment addressing a block (and optionally a range inside it). A derived read model computed by the Seed daemon/API for clients — not a signed net
schemaDefinition: ipfs://bafyreid5g5tiajvqu2iouce53asui6ois525sajhglkrbfk6plquge4guu
---
A parsed URL fragment addressing a block (and optionally a range inside it). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:z7-8RBgX -->

This document describes the **seed-parsed-fragment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:krFKHwrt -->

# Shape <!-- id:syZag7R2 -->

**Extends** [seed-block-range](./seed-block-range.md) with these added fields: <!-- id:yEQ1-H8j -->
  - `blockId` _(required)_ — [string](./onyx-string.md) <!-- id:HheegK47 -->

# Depends on <!-- id:iQNSAaXE -->

- [string](./onyx-string.md) <!-- id:TnlsTizM -->
- [seed-block-range](./seed-block-range.md) <!-- id:Szbd6UUI -->
