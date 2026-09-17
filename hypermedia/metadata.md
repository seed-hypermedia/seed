---
name: Document Metadata
summary: "The attributes of a document, merged from its Changes: the keys Seed understands, the three schema-binding keys, and any custom keys a typed document adds."
---
A document's **metadata** is the map of attributes its [Changes](./change.md) set with [SetAttributes](./change/op/set-attributes.md), merged last-writer-wins per key path. The map is open. Beside the keys listed here a [document](./protocol/documents.md) may carry any custom attribute, and a [typed document](./schema/typed-documents.md) binds a schema that describes those custom keys. Values are the four scalar [values](./value.md) or nested maps of them. <!-- id:kTGd2V7p -->

Any other key is allowed; its value is a [value](./value.md). <!-- id:oALOK8WB -->

# The keys Seed understands <!-- id:O1w2gINW -->

<!-- id:zIyn6ExA -->
| key <!-- col:xbGOa6Mr --> | type <!-- col:JTnU8Igc --> | meaning <!-- col:OqQtuici --> <!-- id:VlWAPhE1 --> |
| --- | --- | --- |
| `name` | string | the document or space title <!-- id:uc52ztCZ --> |
| `summary` | string | a short description shown in previews and cards <!-- id:wmTG08rh --> |
| `icon` | `ipfs://` | a square document or space image <!-- id:vhHgbWls --> |
| `cover` | `ipfs://` | a wide cover image shown in headers and cards <!-- id:X5v-dwDB --> |
| `thumbnail` | `ipfs://` | deprecated image field kept for older documents; use `icon` or `cover` <!-- id:Wdqe6bUa --> |
| `siteUrl` | URL | the web address a space is published at; set on the home document when a site is registered, see [Sites](./protocol/sites.md) <!-- id:AyiR8yjR --> |
| `agentServerUrl` | URL | the agents server a space advertises to its readers (an http(s) origin); clients viewing the space connect to it beside their own servers, see [Environments](./agent/environments.md) <!-- id:Y7jh1Rjp --> |
| `spaceAgents` | map | the agents the space publishes to readers, as `{[agentId]: order}`; each id is an agent on `agentServerUrl`, and a removed agent leaves a null behind. Names and icons are read from the agent itself, so renaming one never strands a stale copy in a signed document <!-- id:_WXOlj66 --> |
| `displayPublishTime` | string | the publication date shown to readers, when it differs from the change history <!-- id:0GpDlsoW --> |
| `displayAuthor` | string | an author byline shown to readers <!-- id:EErr-5X_ --> |
| `showOutline` | boolean | whether to show the document outline <!-- id:lWBPOths --> |
| `showActivity` | boolean | whether to show the document's activity and tools <!-- id:f9udrNO4 --> |
| `contentWidth` | `S`, `M` or `L` | the width of the content column <!-- id:hwmbFhVl --> |
| `childrenType` | string | the layout of the root-level blocks, a [children type](./block/children-type.md) <!-- id:hwzmGVIF --> |
| `layout` | `Seed/Experimental/Newspaper` or `""` | a legacy space header layout <!-- id:O2Gr-cFN --> |
| `theme` | map | visual settings for a space; `theme.headerLayout` is `Center` or `""` <!-- id:nhgEOEF4 --> |
| `seedExperimentalLogo` | `ipfs://` | a logo shown in the space header <!-- id:80rBAuwB --> |
| `seedExperimentalHomeOrder` | `UpdatedFirst` or `CreatedFirst` | a legacy ordering of a space's home listing <!-- id:MLR7Eoo_ --> |
| `importCategories` | string | comma-separated categories kept from an external import such as WordPress <!-- id:71nMVZJ7 --> |
| `importTags` | string | comma-separated tags kept from the same import <!-- id:qVNxoeYG --> |

Three keys bind a document to [Hypermedia Schemas](./schema.md). [Typed documents](./schema/typed-documents.md) explains them in full. <!-- id:DJ5RlO5J -->

<!-- id:GOwfZvE7 -->
| key <!-- col:CwbtunJo --> | on which document <!-- col:TPep4LNq --> | meaning <!-- col:NQXpktio --> <!-- id:ASFYDHtX --> |
| --- | --- | --- |
| `schemaDefinition` | a type's home page | this document **defines** a schema: `ipfs://<cid>` of the schema blob it describes <!-- id:sOmb1wzo --> |
| `attributesSchema` | an instance | the attributes schema **this** document conforms to: the type page's `hm://` URL or `ipfs://<cid>` <!-- id:idnTWx4c --> |
| `childAttributesSchema` | a folder | the attributes schema this document's **children** conform to <!-- id:t-Ks00Sy --> |

Older documents may still carry `title` (now `name`), and old profiles `alias` and `description` (now `summary`). Readers map them. The daemon also keeps internal keys prefixed `$db.` (the redirect, visibility and derived fields) and strips them from the metadata it serves. A site's navigation menu lives in a detached block, outside the metadata; see [navigation item](./metadata/navigation-item.md). <!-- id:9s03Zq9R -->

# Working with metadata <!-- id:9_Lec_uh -->

In the [Seed app](./apps/desktop.md) the Attributes tab edits every key, with the required fields of a bound schema pinned at the top. The [CLI](./build/cli.md) sets keys with `document create --metadata` and with the frontmatter of a markdown file, which lists every key in a fixed order. The [SDK](./build/sdk.md)'s `HMDocumentMetadataSchema` parses the known keys and passes the rest through. The [Seed API](./build/web-api.md)'s `ResourceMetadata` request returns only the metadata, and `QueryDocuments` filters documents by any key. Agents [read](./agent/read.md) `hm://…/:attributes` and [write](./agent/write.md) `options.metadata`. See [the query grammar](./build/query-grammar.md). <!-- id:09DUk8Zl -->

# See also <!-- id:xkWCsJm3 -->

- [document](./document.md): the read model metadata belongs to. <!-- id:kYENKtH7 -->
- [SetAttributes](./change/op/set-attributes.md): the op that writes metadata. <!-- id:qoc9eZTG -->
- [key-value](./key-value.md): one key path and value. <!-- id:p3Fz0BLV -->
- [Typed documents](./schema/typed-documents.md): the schema-binding keys. <!-- id:YJsQMrfm -->
- [navigation item](./metadata/navigation-item.md): the site menu. <!-- id:DYF6jNMP -->
- [ResourceMetadata](./rpc/resource-metadata.md): the API request that returns metadata. <!-- id:CaWZ_NsU -->
