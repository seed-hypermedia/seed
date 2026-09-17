---
name: Document Metadata
summary: "The attributes of a document, merged from its Changes: the keys Seed understands, the three schema-binding keys, and any custom keys a typed document adds."
schemaDefinition: ipfs://bafyreicjyjyo7aqw5wzptnny6htrpa2ue7ghqvtlzlfd37aaosjo6fgqji
---
A document's metadata is the map of attributes its Changes set with [SetAttributes](./change/op/set-attributes.md), merged last-writer-wins per key path. The map is open: beside the keys listed here a document may carry any custom attribute, and a [typed document](./schema/typed-documents.md) binds a schema that describes those custom keys. Values are the four scalar [values](./value.md) or nested maps of them.

# The keys Seed understands

| key | type | meaning |
| --- | --- | --- |
| `name` | string | the document or space title |
| `summary` | string | a short description shown in previews and cards |
| `icon` | `ipfs://` | a square document or space image |
| `cover` | `ipfs://` | a wide cover image shown in headers and cards |
| `thumbnail` | `ipfs://` | deprecated image field kept for older documents; use `icon` or `cover` |
| `siteUrl` | URL | the web address a space is published at; set on the home document when a site is registered, see [Sites](./protocol/sites.md) |
| `agentServerUrl` | URL | the agents server a space advertises to its readers (an http(s) origin); clients viewing the space connect to it beside their own servers, see [Environments](./agent/environments.md) |
| `spaceAgents` | map | the agents the space publishes to readers, as `{[agentId]: order}`; each id is an agent on `agentServerUrl`, and a removed agent leaves a null behind. Names and icons are read from the agent itself, so renaming one never strands a stale copy in a signed document |
| `displayPublishTime` | string | the publication date shown to readers, when it differs from the change history |
| `displayAuthor` | string | an author byline shown to readers |
| `showOutline` | boolean | whether to show the document outline |
| `showActivity` | boolean | whether to show the document's activity and tools |
| `contentWidth` | `S`, `M` or `L` | the width of the content column |
| `childrenType` | string | the layout of the root-level blocks, a [children type](./block/children-type.md) |
| `layout` | `Seed/Experimental/Newspaper` or `""` | a legacy space header layout |
| `theme` | map | visual settings for a space; `theme.headerLayout` is `Center` or `""` |
| `seedExperimentalLogo` | `ipfs://` | a logo shown in the space header |
| `seedExperimentalHomeOrder` | `UpdatedFirst` or `CreatedFirst` | a legacy ordering of a space's home listing |
| `importCategories` | string | comma-separated categories kept from an external import such as WordPress |
| `importTags` | string | comma-separated tags kept from the same import |

Three keys bind a document to Hypermedia Schemas; [typed documents](./schema/typed-documents.md) explains them in full.

| key | on which document | meaning |
| --- | --- | --- |
| `schemaDefinition` | a type's home page | this document **defines** a schema: `ipfs://<cid>` of the schema blob it describes |
| `attributesSchema` | an instance | the attributes schema **this** document conforms to: the type page's `hm://` URL or `ipfs://<cid>` |
| `childAttributesSchema` | a folder | the attributes schema this document's **children** conform to |

Older documents may still carry `title` (now `name`), and old profiles `alias` and `description` (now `summary`); readers map them. The daemon also keeps internal keys prefixed `$db.` (the redirect, visibility and derived fields) that it strips from the metadata it serves. A site's navigation menu is not metadata: it lives in a detached block, see [navigation item](./metadata/navigation-item.md).

# Working with metadata

In the Seed app the Attributes tab edits every key, with the required fields of a bound schema pinned at the top. The CLI sets keys with `document create --metadata` and the frontmatter of a markdown file, which lists every key in a fixed order. The SDK's `HMDocumentMetadataSchema` parses the known keys and passes the rest through. The Seed API's `ResourceMetadata` request returns only the metadata, and `QueryDocuments` filters documents by any key; agents read `hm://…/:attributes` and write `options.metadata`. See [the query grammar](./build/query-grammar.md).

# Shape <!-- id:-ix8zCqi -->

A map with these fields: <!-- id:L2SJyGsk -->
  - `name`: [string](./string.md) <!-- id:A-W8DLNa -->
  - `summary`: [string](./string.md) <!-- id:3LriHtp0 -->
  - `icon`: [ipfs-url](./ipfs-url.md) <!-- id:6dGrRIdx -->
  - `thumbnail`: [ipfs-url](./ipfs-url.md), deprecated
  - `cover`: [ipfs-url](./ipfs-url.md) <!-- id:zjUSdmH1 -->
  - `siteUrl`: [url](./url.md) <!-- id:PyLw_CMi -->
  - `agentServerUrl`: [url](./url.md)
  - `spaceAgents`: map of [value](./value.md)
  - `attributesSchema`: [hm-url](./hm-url.md) <!-- id:ADiIVpjJ -->
  - `childAttributesSchema`: [hm-url](./hm-url.md) <!-- id:UONmILsQ -->
  - `schemaDefinition`: [ipfs-url](./ipfs-url.md), targeting [schema](./schema.md) <!-- id:ZUbSthmD -->
  - `layout`: one of `"Seed/Experimental/Newspaper"` | `""` <!-- id:I-9Xt4-i -->
  - `seedExperimentalLogo`: [ipfs-url](./ipfs-url.md)
  - `seedExperimentalHomeOrder`: one of `"UpdatedFirst"` | `"CreatedFirst"`
  - `displayPublishTime`: [string](./string.md) <!-- id:t_InI3WT -->
  - `displayAuthor`: [string](./string.md) <!-- id:b3VkN4qc -->
  - `showOutline`: [boolean](./boolean.md) <!-- id:PGeCxMgg -->
  - `showActivity`: [boolean](./boolean.md) <!-- id:Rfm2qV8U -->
  - `contentWidth`: one of `"S"` | `"M"` | `"L"` <!-- id:8si9AhAF -->
  - `childrenType`: [string](./string.md) <!-- id:-HIIWHMr -->
  - `theme`: struct { `headerLayout` — one of `"Center"` | `""` } <!-- id:Gz2wxX6C -->
  - `importCategories`: [string](./string.md)
  - `importTags`: [string](./string.md)

Any other key is allowed; its value is a [value](./value.md).

# Depends on <!-- id:ZvzKpaKj -->

- [value](./value.md) <!-- id:9xa9orX2 -->
- [boolean](./boolean.md) <!-- id:iyrNR-f0 -->
- [string](./string.md) <!-- id:W8yIt82N -->
- [url](./url.md)
- [hm-url](./hm-url.md)
- [ipfs-url](./ipfs-url.md)
- [schema](./schema.md)
