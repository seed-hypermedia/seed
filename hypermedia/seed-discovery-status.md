---
name: Discovery status
summary: "The state of a background discovery task for a resource: pending, found (with the resolved version), or failed (with the error). A derived read model computed b"
schemaDefinition: ipfs://bafyreigagynio6tr57wby7ir5zrvzfibkbupmtavg3fpij6khjodtlkzxe
---
The state of a background discovery task for a resource: pending, found (with the resolved version), or failed (with the error). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:qgX0_Pnd -->

This document describes the **seed-discovery-status** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Yrc4tz-K -->

# Shape <!-- id:5S7wQzcJ -->

A **closed struct** with these fields: <!-- id:30yArQuX -->
  - `state` _(required)_ — `string` enum: `pending` `found` `failed` <!-- id:9LZFnDbh -->
  - `version` — [string](./onyx-string.md) <!-- id:8vEiaWJC -->
  - `error` — [string](./onyx-string.md) <!-- id:7izs2ZlP -->

# Depends on <!-- id:2Ac_QMa3 -->

- [string](./onyx-string.md) <!-- id:mvuguHT_ -->
