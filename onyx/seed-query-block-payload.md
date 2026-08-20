---
name: "Query block payload"
summary: "Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/A"
---

# Query block payload

Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-query-block-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `queryTargetName` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `in` *(required)* — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
- `results` *(required)* — list of [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info)
- `mode` — `string` enum: `Children` `AllDescendants`
- `interactionSummaries` *(required)* — map ⟨ * : [seed-query-block-item-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-block-item-summary) ⟩
- `accountsMetadata` *(required)* — [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata)

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata)
- [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info)
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
- [seed-query-block-item-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-block-item-summary)
