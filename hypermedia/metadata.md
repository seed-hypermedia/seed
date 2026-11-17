---
name: Document Metadata
summary: "The attributes of a document, merged from its Changes: the keys Seed understands, the three schema-binding keys, and any custom keys a typed document adds."
---
A document's **metadata** is its map of attributes, such as `name`, `summary` and `icon`. [Changes](./change.md) set attributes with the [SetAttributes](./change/op/set-attributes.md) operation. When two Changes set the same key path, the newest write wins. The map is open: beside the keys listed here, a [document](./protocol/documents.md) may carry any custom attribute. A [typed document](./schema/typed-documents.md) binds a schema that describes those custom keys. A [value](./value.md) is usually a string, an integer, a boolean or null. The [SDK](./build/sdk.md) and the [CLI](./build/cli.md) can also write a list or a whole map as one value. The section on sets, maps and lists below says when to use each. <!-- id:kTGd2V7p -->

A value that names an [account](./protocol/identity.md) or a document is a link. This applies to an attribute, such as `owner`, whose value is a bare account ID (`z6Mk…`), an account's home URL (`hm://<uid>`), a `:profile` URL or any other [`hm://` URL](./protocol/urls.md) of a document. The [daemon](./software/daemon.md) indexes it as a [citation](./protocol/links-and-citations.md) of type `metadata/Link`. The citation's anchor is the attribute key, and its source is the document that set the attribute. It appears among the target's citations, like a link in the body. When the target is an account, it also counts as a mention of that account: the notification server emails them, and a `user-mention` [trigger](./trigger.md) fires. A URL whose authority is not an account, such as the `type` key's `hm://hyper.media/page`, is not a link.

# The keys Seed understands <!-- id:O1w2gINW -->

<!-- id:zIyn6ExA -->
| key <!-- col:xbGOa6Mr --> | type <!-- col:JTnU8Igc --> | meaning <!-- col:OqQtuici --> <!-- id:VlWAPhE1 --> |
| --- | --- | --- |
| `name` | string | the document or [space](./protocol/spaces.md) title <!-- id:uc52ztCZ --> |
| `summary` | string | a short description shown in previews and cards <!-- id:wmTG08rh --> |
| `icon` | `ipfs://` | a square document or space image <!-- id:vhHgbWls --> |
| `cover` | `ipfs://` | a wide cover image shown in headers and cards <!-- id:X5v-dwDB --> |
| `thumbnail` | `ipfs://` | deprecated image field kept for older documents; use `icon` or `cover` <!-- id:Wdqe6bUa --> |
| `siteUrl` | URL | the web address a space is published at; set on the [home document](./protocol/spaces.md) when a site is registered, see [Sites](./protocol/sites.md) <!-- id:AyiR8yjR --> |
| `appEnvironmentUrl` | URL | the [app environment](./software/app-environment.md) that runs an [app](./app.md), set on the app document when the app is created. Without it, the app runs on the environment that its space's site advertises in `/hm/api/config` |
| `agentServerUrl` | URL | the app environment that hosts the agent this document mounts (an http(s) origin), set together with `type: hm://hyper.media/agent`; the document's versionless id is the agent's id, and a space's agents are found by querying its documents for that type, see [Agents](./agent.md) <!-- id:Y7jh1Rjp --> |
| `type` | URL | the resource type; custom HTML pages declare [hm://hyper.media/page](./page.md), [apps](./app.md) `hm://hyper.media/app`, their tools `hm://hyper.media/tool` and their [triggers](./trigger.md) `hm://hyper.media/trigger` <!-- id:3-HON7jT --> |
| `inputSchema` | URL | a published HM [struct](./struct.md) defining a custom HTML page's URL input (see [Page input](./page-input.md)) or what an [app tool](./tool.md) takes <!-- id:lGfreYXM --> |
| `outputSchema` | URL | a published HM struct defining what an [app tool](./tool.md) returns |
| `code` | `ipfs://` | an [app tool](./tool.md)'s code: a UnixFS folder whose `index.ts` default-exports the tool's async function |
| `source`, `tool`, `input`, `enabled` | `ipfs://`, URL, `ipfs://`, boolean | a [trigger](./trigger.md)'s source ([DAG-CBOR](./schema/dag-cbor.md)), the host tool it calls, that tool's input template (DAG-CBOR), and whether it is on |
| `homePage` | URL | the hm:// URL of one of an [app](./app.md)'s own pages, which its Home tab shows |
| `publicConfig` | map | an [app](./app.md)'s public settings, readable by anyone who can read the app |
| `publicConfigSchema`, `privateConfigSchema` | URL | the schemas of an [app](./app.md)'s public config and private config |
| `html` | `ipfs://` | a [custom HTML page](./build/custom-pages.md): a UnixFS folder whose `index.html` is a self-contained HTML page that Seed opens in place of the document body, sandboxed, with a bridge to read Hypermedia as the viewer |
| `displayPublishTime` | string | the publication date shown to readers, when it differs from the change history <!-- id:0GpDlsoW --> |
| `displayAuthor` | string | an author byline shown to readers <!-- id:EErr-5X_ --> |
| `showOutline` | boolean | whether to show the document outline <!-- id:lWBPOths --> |
| `showActivity` | boolean | whether to show the document's activity and tools <!-- id:f9udrNO4 --> |
| `showConversations` | boolean | whether readers may start and join conversations on the space's documents; set on a space home document, absent means they may |
| `showDocumentBrowser` | boolean | whether the sidebar with the space's document browser starts open when readers arrive; when false it starts collapsed and readers can still open it; set on a space home document, absent means it starts open |
| `showCollectionControls` | boolean | whether collections offer readers search, filter, sort and view controls; set on a space home document, absent means they do |
| `contentWidth` | `S`, `M` or `L` | the width of the content column <!-- id:hwmbFhVl --> |
| `childrenType` | string | the layout of the root-level [blocks](./protocol/blocks.md), a [children type](./block/children-type.md) <!-- id:hwzmGVIF --> |
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
| `schemaDefinition` | a type's home page | this document **defines** a schema: `ipfs://<cid>` of the schema [blob](./protocol/blobs.md) it describes <!-- id:sOmb1wzo --> |
| `attributesSchema` | an instance | the attributes schema **this** document conforms to: the type page's `hm://` URL or `ipfs://<cid>` <!-- id:idnTWx4c --> |
| `childAttributesSchema` | a folder | the attributes schema this document's **children** conform to <!-- id:t-Ks00Sy --> |

Documents may also carry `title`, which readers map to `name`. A [profile](./profile.md)'s `description` is shown where a document's `summary` would be. The daemon also keeps internal keys that start with `$db.` (the redirect, the visibility and derived fields). It removes them from the metadata it serves. A site's navigation menu is not in the metadata. It lives in a detached block; see [navigation item](./metadata/navigation-item.md). <!-- id:9s03Zq9R -->

# Sets, maps and lists in attributes

Each key path merges on its own, and the newest write to it wins. [Documents](./protocol/documents.md) has the exact rule.

**What this means for data you keep in attributes.** The shape of the data decides what survives when two people edit at the same time:

- **A map written one key per entry** (`tags.dinner = true`, `tags.quick = true`) merges well. Two people who change different entries both keep their edits. One entry can change without touching the rest. A null removes one entry. Every entry is searchable, because the attribute index stores each single value under its dotted key path.
- **A list is one value.** No operation inserts or removes one item. A write replaces the whole list, and the later write wins. If two people edit a list at the same time, only one edit survives. The attribute index skips lists, so you cannot search or filter on them. A list reads back exactly as it was written.
- **A whole map written as one value** (`tags = {dinner: true}`) behaves like a list: it replaces every older entry under that key.
- **To replace a map exactly**, write a null at its key and then its entries, in one Change. The null removes every older entry. The entries have newer op ids than the null, so they win over it.

So store a set as `{<item>: true}`, and a keyed collection as a map keyed by id. Keep a list only for a small value that one writer edits as a unit. Anything ordered that several people edit belongs in the body, where blocks merge as an ordered tree, or in child documents. Trigger documents follow these rules: see [triggers](./trigger.md).

# Working with metadata <!-- id:9_Lec_uh -->

In the [Seed app](./software/desktop.md), the Attributes tab edits every key. The required fields of a bound schema are pinned at the top. The [CLI](./build/cli.md) sets keys with `document create --metadata`, and with the frontmatter of a markdown file, which lists every key in a fixed order. The [SDK](./build/sdk.md)'s `HMDocumentMetadataSchema` parses the known keys and passes the rest through. The [Seed API](./build/web-api.md)'s `ResourceMetadata` request returns only the metadata, and `QueryDocuments` filters documents by any key. Agents [read](./agent/read.md) `hm://…/:attributes` and [write](./agent/write.md) `options.metadata`. See [the query grammar](./build/query-grammar.md). <!-- id:09DUk8Zl -->

# See also <!-- id:xkWCsJm3 -->

- [document](./document.md): the read model metadata belongs to. <!-- id:kYENKtH7 -->
- [SetAttributes](./change/op/set-attributes.md): the op that writes metadata. <!-- id:qoc9eZTG -->
- [key-value](./key-value.md): one key path and value. <!-- id:p3Fz0BLV -->
- [Typed documents](./schema/typed-documents.md): the schema-binding keys. <!-- id:YJsQMrfm -->
- [navigation item](./metadata/navigation-item.md): the site menu. <!-- id:DYF6jNMP -->
- [Seed API](./build/web-api.md): `ResourceMetadata` returns metadata. <!-- id:CaWZ_NsU -->

# Pages in this section <!-- id:BVpU58jG attrs:{"childrenType":"Grid","columnCount":3} -->

<./metadata/navigation-item.md> <!-- id:taijXciG type:Embed attrs:{"view":"Card"} -->
