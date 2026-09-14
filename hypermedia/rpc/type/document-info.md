---
name: Document info
summary: "One document in a listing (query results, directories): identity, authorship, timestamps, breadcrumbs, and its activity summary — without the full content. A de"
schemaDefinition: ipfs://bafyreif5xegdynuam64pswo37cr4nxe6whqchzhhnks2idu5ggx5ejnheu
---
One document in a listing (query results, directories): identity, authorship, timestamps, breadcrumbs, and its activity summary — without the full content. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:OgH907y3 -->

This document describes the **rpc/type/document-info** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:cNYjZmUW -->

# Shape <!-- id:lMYeC4DK -->

A **closed struct** with these fields: <!-- id:JQCMU3uI -->
  - `type` _(required)_ — `"document"` <!-- id:EkpuRfkl -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:4VVfYH_e -->
  - `path` _(required)_ — list of [string](../../schema/string.md) <!-- id:A9ajQXb_ -->
  - `authors` _(required)_ — list of [string](../../schema/string.md) <!-- id:_uPzrha3 -->
  - `createTime` _(required)_ — [schema/timestamp](../../schema/timestamp.md) <!-- id:3RABUqT6 -->
  - `updateTime` _(required)_ — [schema/timestamp](../../schema/timestamp.md) <!-- id:BkzIrpr_ -->
  - `sortTime` _(required)_ — [string](../../schema/string.md) <!-- id:JIjiRvAQ -->
  - `genesis` _(required)_ — [string](../../schema/string.md) <!-- id:Z1kajVwn -->
  - `version` _(required)_ — [string](../../schema/string.md) <!-- id:M6ZV22FP -->
  - `breadcrumbs` _(required)_ — list of [rpc/type/breadcrumb](./breadcrumb.md) <!-- id:6-_0qrTO -->
  - `activitySummary` _(required)_ — [rpc/type/activity-summary](./activity-summary.md) <!-- id:_7KE0iso -->
  - `generationInfo` _(required)_ — map { 2 fields } <!-- id:TAxxiK1e -->
  - `redirectInfo` — [rpc/type/redirect-info](./redirect-info.md) <!-- id:RDlcQ0Cv -->
  - `metadata` _(required)_ — [metadata](../../metadata.md) <!-- id:sJz5N_pg -->
  - `firstImageInContent` — [string](../../schema/string.md) <!-- id:5w2RRbrg -->
  - `visibility` _(required)_ — [visibility](../../visibility.md) <!-- id:d1YCn1pJ -->

# Depends on <!-- id:IsmdwRwB -->

- [metadata](../../metadata.md) <!-- id:Q7Z96een -->
- [schema/timestamp](../../schema/timestamp.md) <!-- id:bAnZCGsa -->
- [visibility](../../visibility.md) <!-- id:AeCWNO95 -->
- [integer](../../schema/integer.md) <!-- id:9guKeYjp -->
- [string](../../schema/string.md) <!-- id:f4Izt9d_ -->
- [rpc/type/activity-summary](./activity-summary.md) <!-- id:uce6DPdj -->
- [rpc/type/breadcrumb](./breadcrumb.md) <!-- id:pW674sZt -->
- [rpc/type/id](./id.md) <!-- id:f-OIRb8y -->
- [rpc/type/redirect-info](./redirect-info.md) <!-- id:9I8fkVGm -->
