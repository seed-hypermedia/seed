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
  - `id` _(required)_ — [seed-id](./seed-id.md) <!-- id:4VVfYH_e -->
  - `path` _(required)_ — list of [string](./onyx-string.md) <!-- id:A9ajQXb_ -->
  - `authors` _(required)_ — list of [string](./onyx-string.md) <!-- id:_uPzrha3 -->
  - `createTime` _(required)_ — [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:3RABUqT6 -->
  - `updateTime` _(required)_ — [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:BkzIrpr_ -->
  - `sortTime` _(required)_ — [string](./onyx-string.md) <!-- id:JIjiRvAQ -->
  - `genesis` _(required)_ — [string](./onyx-string.md) <!-- id:Z1kajVwn -->
  - `version` _(required)_ — [string](./onyx-string.md) <!-- id:M6ZV22FP -->
  - `breadcrumbs` _(required)_ — list of [seed-breadcrumb](./seed-breadcrumb.md) <!-- id:6-_0qrTO -->
  - `activitySummary` _(required)_ — [seed-activity-summary](./seed-activity-summary.md) <!-- id:_7KE0iso -->
  - `generationInfo` _(required)_ — map { 2 fields } <!-- id:TAxxiK1e -->
  - `redirectInfo` — [seed-redirect-info](./seed-redirect-info.md) <!-- id:RDlcQ0Cv -->
  - `metadata` _(required)_ — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:sJz5N_pg -->
  - `firstImageInContent` — [string](./onyx-string.md) <!-- id:5w2RRbrg -->
  - `visibility` _(required)_ — [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:d1YCn1pJ -->

# Depends on <!-- id:IsmdwRwB -->

- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:Q7Z96een -->
- [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:bAnZCGsa -->
- [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:AeCWNO95 -->
- [integer](./onyx-integer.md) <!-- id:9guKeYjp -->
- [string](./onyx-string.md) <!-- id:f4Izt9d_ -->
- [seed-activity-summary](./seed-activity-summary.md) <!-- id:uce6DPdj -->
- [seed-breadcrumb](./seed-breadcrumb.md) <!-- id:pW674sZt -->
- [seed-id](./seed-id.md) <!-- id:f-OIRb8y -->
- [seed-redirect-info](./seed-redirect-info.md) <!-- id:9I8fkVGm -->
