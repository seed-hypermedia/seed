---
name: Document Info
summary: "One document in a listing: identity, authorship, timestamps, breadcrumbs, and activity summary, without the full content."
schemaDefinition: ipfs://bafyreie5rclecbw2pqlbehohpvckb6h3zimyr7ssisluedfrrehz2axi2m
---
One [document](../../protocol/documents.md) in a listing, such as query results or a directory. It carries identity, authorship, timestamps, [breadcrumbs](./breadcrumb.md) and an [activity summary](./activity-summary.md), without the full content. <!-- id:OgH907y3 -->

This page describes the **rpc/type/document-info** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:cNYjZmUW -->

# Shape <!-- id:lMYeC4DK -->

A **closed struct** with these fields: <!-- id:JQCMU3uI -->
  - `type` _(required)_: `"document"` <!-- id:EkpuRfkl -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:4VVfYH_e -->
  - `path` _(required)_: list of [string](../../string.md) <!-- id:A9ajQXb_ -->
  - `authors` _(required)_: list of [string](../../string.md) <!-- id:_uPzrha3 -->
  - `createTime` _(required)_: [timestamp](../../timestamp.md) <!-- id:3RABUqT6 -->
  - `updateTime` _(required)_: [timestamp](../../timestamp.md) <!-- id:BkzIrpr_ -->
  - `sortTime` _(required)_: [string](../../string.md) <!-- id:JIjiRvAQ -->
  - `genesis` _(required)_: [string](../../string.md) <!-- id:Z1kajVwn -->
  - `version` _(required)_: [string](../../string.md) <!-- id:M6ZV22FP -->
  - `breadcrumbs` _(required)_: list of [rpc/type/breadcrumb](./breadcrumb.md) <!-- id:6-_0qrTO -->
  - `activitySummary` _(required)_: [rpc/type/activity-summary](./activity-summary.md) <!-- id:_7KE0iso -->
  - `generationInfo` _(required)_: map { 2 fields } <!-- id:TAxxiK1e -->
  - `redirectInfo`: [rpc/type/redirect-info](./redirect-info.md) <!-- id:RDlcQ0Cv -->
  - `metadata` _(required)_: [metadata](../../metadata.md) <!-- id:sJz5N_pg -->
  - `firstImageInContent`: [string](../../string.md) <!-- id:5w2RRbrg -->
  - `visibility` _(required)_: [visibility](../../visibility.md) <!-- id:d1YCn1pJ -->

# Depends on <!-- id:IsmdwRwB -->

- [metadata](../../metadata.md) <!-- id:Q7Z96een -->
- [timestamp](../../timestamp.md) <!-- id:bAnZCGsa -->
- [visibility](../../visibility.md) <!-- id:AeCWNO95 -->
- [integer](../../integer.md) <!-- id:9guKeYjp -->
- [string](../../string.md) <!-- id:f4Izt9d_ -->
- [rpc/type/activity-summary](./activity-summary.md) <!-- id:uce6DPdj -->
- [rpc/type/breadcrumb](./breadcrumb.md) <!-- id:pW674sZt -->
- [rpc/type/id](./id.md) <!-- id:f-OIRb8y -->
- [rpc/type/redirect-info](./redirect-info.md) <!-- id:9I8fkVGm -->

# See also

- [Document (Payload)](./document.md): the full document.
- [Query Result](./query-result.md): a listing of document info.
- [Redirect Info](./redirect-info.md): a listed document that redirects.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
