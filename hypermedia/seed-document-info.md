---
name: Document info
summary: "One document in a listing (query results, directories): identity, authorship, timestamps, breadcrumbs, and its activity summary — without the full content. A de"
schemaDefinition: ipfs://bafyreihv345pqy3jkrkffef47imgcjfarjwhe6qya4d7f6n6xhtjryypea
---
One document in a listing (query results, directories): identity, authorship, timestamps, breadcrumbs, and its activity summary — without the full content. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:OgH907y3 -->

This document describes the **seed-document-info** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:cNYjZmUW -->

# Shape <!-- id:lMYeC4DK -->
A **closed struct** with these fields: <!-- id:JQCMU3uI -->
  - `type` _(required)_ — `string` enum: `document` <!-- id:EkpuRfkl -->
  - `id` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:4VVfYH_e -->
  - `path` _(required)_ — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:A9ajQXb_ -->
  - `authors` _(required)_ — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:_uPzrha3 -->
  - `createTime` _(required)_ — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:3RABUqT6 -->
  - `updateTime` _(required)_ — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:BkzIrpr_ -->
  - `sortTime` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:JIjiRvAQ -->
  - `genesis` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Z1kajVwn -->
  - `version` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:M6ZV22FP -->
  - `breadcrumbs` _(required)_ — list of [seed-breadcrumb](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-breadcrumb) <!-- id:6-_0qrTO -->
  - `activitySummary` _(required)_ — [seed-activity-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-activity-summary) <!-- id:_7KE0iso -->
  - `generationInfo` _(required)_ — map { 2 fields } <!-- id:TAxxiK1e -->
  - `redirectInfo` — [seed-redirect-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-redirect-info) <!-- id:RDlcQ0Cv -->
  - `metadata` _(required)_ — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:sJz5N_pg -->
  - `firstImageInContent` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:5w2RRbrg -->
  - `visibility` _(required)_ — [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:d1YCn1pJ -->

# Depends on <!-- id:IsmdwRwB -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:Q7Z96een -->
- [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:bAnZCGsa -->
- [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:AeCWNO95 -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:9guKeYjp -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:f4Izt9d_ -->
- [seed-activity-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-activity-summary) <!-- id:uce6DPdj -->
- [seed-breadcrumb](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-breadcrumb) <!-- id:pW674sZt -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:f-OIRb8y -->
- [seed-redirect-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-redirect-info) <!-- id:9I8fkVGm -->