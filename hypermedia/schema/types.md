---
name: Catalogue of Types
summary: Every type in the Hypermedia Schemas library with one line each, grouped into value types, protocol types, the meta-schema and the examples.
---
This page lists every type in the [Hypermedia Schemas](../schema.md) library. Each type has a page at the address of its name: the type `change/body` is `hm://hyper.media/change/body`, and its page is [change/body](../change/body.md). The name in backticks after each link is that library name. [References and naming](./references.md) explains the names, and [the schema language](./schema-language.md) explains how the types are written.

# Value types

These are the types of plain values. [The data model](./data-model.md) explains the kinds they are built from.

## Kinds

One [primitive](./primitive.md) per [kind](./kind.md), plus `struct`, the second type the schema language gives to the `map` kind.

- [Null](../null.md) (`null`): The null value.
- [Boolean](../boolean.md) (`boolean`): A true or false value.
- [Integer](../integer.md) (`integer`): A whole number, which DAG-CBOR encodes distinctly from floats.
- [Float](../float.md) (`float`): A floating-point number.
- [String](../string.md) (`string`): UTF-8 text.
- [Bytes](../bytes.md) (`bytes`): Raw binary data (a byte string).
- [Link](../link.md) (`link`): The IPLD link kind, a CID inside a value that points at another block by its content, encoded as CBOR tag 42 and spelled with a slash key in DAG-JSON.
- [List](../list.md) (`list`): An ordered sequence, which is List\<Any> until it is parameterized with items.
- [Map](../map.md) (`map`): A map of string keys to values of one type (Map\<Any> until `values` constrains it); use a struct when the field names are known.
- [Struct](../struct.md) (`struct`): A map with known, named fields, the type behind every record-like value from an address to a signed Change.

## Top, bottom and the scalar union

- [Any](../any.md) (`any`): The top type that matches any Hypermedia value: null, boolean, number, string, bytes, link, or a list or map of any.
- [None](../none.md) (`none`): The bottom type, which accepts no values and is defined as an empty union.
- [Value](../value.md) (`value`): A metadata or attribute value: a string, an integer, a boolean, or null.

## Refined strings

Each is a string with a `format` that tells an editor which control to show.

- [Date](../date.md) (`date`): A calendar date held as an ISO 8601 `YYYY-MM-DD` string, with `format: date` so editors show a date picker and validators can check the shape.
- [Date-Time](../date-time.md) (`date-time`): An instant held as an RFC 3339 string such as `2026-08-26T14:30:00Z`, with `format: date-time` so editors show a date-and-time picker.
- [URL](../url.md) (`url`): A string holding a URL of any scheme, which `format: url` tells an editor to render as a link and to validate as one.
- [Hypermedia URL](../hm-url.md) (`hm-url`): A reference to a Hypermedia document held as an `hm://` URL string, which editors render as a searchable pill showing the target’s title.
- [IPFS URL](../ipfs-url.md) (`ipfs-url`): A reference to a content-addressed object held as an `ipfs://<cid>` string, which editors render as a file pill you can open, upload to, or paste into.
- [Account](../account.md) (`account`): A reference to an account, held as the bare `hm://<principal>` URL, with `format: hm-profile` so editors offer an account search and accept a pasted principal.

## Aliases used inside blobs

Plain names for the kinds the signed blobs carry.

- [CID](../cid.md) (`cid`): A content identifier, the self-describing hash that names a blob by its bytes, written in Hypermedia as CIDv1 with the dag-cbor codec and either a SHA-256 or a BLAKE2b-256 multihash.
- [Principal](../principal.md) (`principal`): A public key that identifies an account or space, stored in blobs as the raw bytes of a multicodec prefix plus the key and shown to people as a base58 string starting with z6Mk.
- [Signature](../signature.md) (`signature`): The 64 raw bytes of an Ed25519 or P-256 signature over a blob's canonical CBOR encoding taken with this very field set to zeros.
- [Timestamp](../timestamp.md) (`timestamp`): A point in time as an integer of Unix milliseconds, issued by a causal clock when a blob is signed and never checked against wall-clock time on arrival.

# Protocol types

These type the data the Hypermedia Network stores and the documents it computes. [Network blobs](./blobs.md) explains how they fit together.

## The envelope and the six blobs

- [Blob](../blob.md) (`blob`): The signed envelope every Hypermedia blob extends, with a type tag, the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a millisecond timestamp.
- [Any Blob](../blob/any.md) (`blob/any`): Any Hypermedia CBOR blob: the discriminated union of the six blob types, tagged on the type field.
- [Change](../change.md) (`change`): A signed delta on a document that links the changes it depends on into a causal graph and carries the operations that mutate the document's content and metadata.
- [Ref](../ref.md) (`ref`): A signed claim, like a Git ref, that a path in a space points at the current head Changes of a document, or that the path is deleted or redirects elsewhere.
- [Comment](../comment.md) (`comment`): A signed comment on a document version, threaded through threadRoot and replyParent, with a body that is a tree of comment blocks.
- [Capability](../capability.md) (`capability`): A signed grant from a space owner to another key: a role (WRITER or AGENT), an optional path scope, and nothing that expires or revokes it.
- [Contact](../contact.md) (`contact`): A public address-book entry: one account's name for another account, with flags that say whether it joined that account's site or follows its profile.
- [Profile](../profile.md) (`profile`): A snapshot blob giving an account its display name, avatar and description, or an alias that redirects one key to another; readers merge every profile for an account field by field.

## Parts of blobs

- [Change Body](../change/body.md) (`change/body`): The operations payload of a Change, an ordered list of ops plus an advisory count of the logical operations they represent.
- [Operation](../change/op.md) (`change/op`): One step inside a Change body, a map tagged by type that sets metadata, replaces a block, moves blocks, or deletes blocks, and the page explains how each op mutates the document.
- [SetAttributes Op](../change/op/set-attributes.md) (`change/op/set-attributes`): The operation that sets document metadata by key path, where each path is a last-writer-wins register and a nested write prunes older values above and below it.
- [ReplaceBlock Op](../change/op/replace-block.md) (`change/op/replace-block`): The operation that sets the full state of one block, its id, type, text, link, annotations and attributes, where the newest replacement by op id wins.
- [MoveBlocks Op](../change/op/move-blocks.md) (`change/op/move-blocks`): The operation that places a contiguous run of blocks under a parent after a reference position, using RGA op ids so concurrent moves converge and the latest move of a block wins.
- [DeleteBlocks Op](../change/op/delete-blocks.md) (`change/op/delete-blocks`): The operation that removes blocks from the visible tree by moving them to the trash parent, from which a later move can restore them.
- [SetKey Op](../change/op/set-key.md) (`change/op/set-key`): The deprecated flat form of SetAttributes that sets a single top-level metadata key, still accepted so old Changes replay.
- [Key/Value](../key-value.md) (`key-value`): One attribute assignment in a SetAttributes op: a key path (a list of segments) and a scalar value.
- [Redirect Target](../ref/redirect-target.md) (`ref/redirect-target`): The destination carried by a redirect Ref, a space and path to send readers to, with a republish flag that keeps the content showing under the old address.
- [Contact Subscription](../contact/subscribe.md) (`contact/subscribe`): The two follow flags on a contact: site means the account joined the subject's site, profile means it follows the subject as a person.
- [Role](../role.md) (`role`): The kind of capability being granted: WRITER may publish under a path, AGENT may act as the issuing account; no other role exists in data.
- [Visibility](../visibility.md) (`visibility`): The visibility of a Ref or Comment, empty for public and "Private" for private, from which every Change and file it links inherits its own visibility.

## Documents

- [Document](../document.md) (`document`): The read model of a Hypermedia document, the metadata and block tree that result from replaying its Changes, and the base every typed document's attributes are folded into.
- [Document Metadata](../metadata.md) (`metadata`): The attributes of a document, merged from its Changes: the keys Seed understands, the three schema-binding keys, and any custom keys a typed document adds.
- [Navigation item](../metadata/navigation-item.md) (`metadata/navigation-item`): One entry of a site's navigation menu: a Link block with display text and a link, stored as a child of the detached navigation block.
- [Query](../query.md) (`query`): A live document query: which spaces and paths to include, how to sort, and an optional limit; the payload of a Query block and of the Query request.
- [Query Inclusion](../query/inclusion.md) (`query/inclusion`): One source a query pulls documents from: a space, an optional path prefix inside it, and whether to list direct children or all descendants.
- [Query Sort](../query/sort.md) (`query/sort`): One sort term for query results, optionally reversed; the app writes lowercase terms and normalizes the older capitalized spellings on read.
- [Query Style](../query/style.md) (`query/style`): How a Query block presents its results: a card grid, a compact list, or a table.
- [Query Table Config](../query/table-config.md) (`query/table-config`): The persisted settings of a Query block's table view: which columns are visible and how wide they are.

## Resource types

Types a document takes on when it is more than a page of text.

- [Page](../page.md) (`page`): A page is a document typed hm://hyper.media/page that carries an HTML bundle and an input schema, runs sandboxed in the viewer's client, and acts as the viewer under approvals the viewer gives step by step.
- [Page Input](../page-input.md) (`page-input`): A page takes typed input from its URL, declared by the struct schema its inputSchema names, and this closed, empty struct is the default for a page that takes none.
- [Seed Agents](../agent.md) (`agent`): An agent is a language model with memory, tools and its own Seed identity, which runs on an app environment and reads and writes Hypermedia like any other participant.

## Blocks

The [block](../block.md) page lists the block model in reading order.

- [Block](../block.md) (`block`): The open wire block: id and type plus text, link, annotations and any attributes, so a document with a block type you do not know still parses.
- [Block (Base)](../block/base.md) (`block/base`): The three fields every concrete block type shares: the required id and type, and the daemon-filled revision.
- [Core Block](../block/core.md) (`block/core`): The strict union of the fifteen built-in block types; extend it with your own types by making a larger union that includes it.
- [Block Node](../block/node.md) (`block/node`): One node of a content tree: a block plus its ordered child nodes, recursively, which is how documents and comments nest content.
- [Annotation](../block/annotation.md) (`block/annotation`): An inline layer over a block's text: a type, one or more code-point ranges, an optional link and inline attributes, used for formatting, links and mentions.
- [Comment Block](../block/comment.md) (`block/comment`): A block inside a comment body: the open block plus a recursive list of child comment blocks.

### The fifteen core blocks

- [Paragraph Block](../block/paragraph.md) (`block/paragraph`): The default block: a paragraph of text with inline annotations; inside a table row it is a cell and carries the column id.
- [Heading Block](../block/heading.md) (`block/heading`): A section heading whose children are the section; the heading level comes from nesting, not from an attribute.
- [Code Block](../block/code.md) (`block/code`): A block of verbatim text, optionally tagged with a programming language for highlighting.
- [Math Block](../block/math.md) (`block/math`): A block of LaTeX math, stored as text and rendered with KaTeX.
- [Image Block](../block/image.md) (`block/image`): An image referenced by an ipfs:// link, with a caption in the text field and an optional display width.
- [Video Block](../block/video.md) (`block/video`): A video referenced by an ipfs:// file or a supported web video URL, with playback attributes.
- [File Block](../block/file.md) (`block/file`): An attachment of any kind, referenced by an ipfs:// link, with its file name and size.
- [Button Block](../block/button.md) (`block/button`): A call-to-action button: a label, a required link and a horizontal alignment.
- [Embed Block](../block/embed.md) (`block/embed`): An embed of another Hypermedia document, block or text range by hm:// link, rendered as content, a card, its comments or a link.
- [Web Embed Block](../block/web-embed.md) (`block/web-embed`): An embed of an external web page or post by https:// URL.
- [Nostr Block](../block/nostr.md) (`block/nostr`): An embed of a Nostr event by nostr: URL.
- [Query Block](../block/query.md) (`block/query`): A block that embeds a live query: the matching documents render in place as cards, a list or a table.
- [Table Block](../block/table.md) (`block/table`): The container of a table: its children are TableColumn markers followed by TableRow blocks whose Paragraph cells carry a columnId.
- [Table Row Block](../block/table-row.md) (`block/table-row`): One row of a Table block: its children are Paragraph cells, each naming its column with a columnId attribute.
- [Table Column Block](../block/table-column.md) (`block/table-column`): One column of a Table block: a childless marker whose id cells reference and whose sibling order is the display order.

### Block enums

- [Children Type](../block/children-type.md) (`block/children-type`): How a block lays out its children: Group (the default), Ordered, Unordered, Blockquote or Grid.
- [Text Alignment](../block/text-alignment.md) (`block/text-alignment`): The horizontal alignment of a block's text: left, center, right or justify.
- [Button Alignment](../block/button-alignment.md) (`block/button-alignment`): The horizontal alignment of a Button block: flex-start, center or flex-end.
- [Embed View](../block/embed-view.md) (`block/embed-view`): How an Embed block renders its target: the content itself, a card, its discussion, or a plain link.

# The meta-schema

These type schemas themselves. [The schema language](./schema-language.md) is the reference for all of them.

- [Schema](../schema.md) (`schema`): The meta-schema, which is the union of every shape a schema can take and a valid instance of itself, and the starting point for every page about Hypermedia Schemas.
- [Struct schema](./struct-schema.md) (`schema/struct-schema`): The variant for a struct, with known fields under properties and optionally extra keys of one type under values.
- [Map schema](./map-schema.md) (`schema/map-schema`): The variant for a map whose keys are arbitrary and whose values all match the one schema under values, while known fields belong in a struct schema.
- [List schema](./list-schema.md) (`schema/list-schema`): The variant for a list value, where items types the elements.
- [Scalar schema](./scalar-schema.md) (`schema/scalar-schema`): The variant for a null, boolean, integer, float, string or bytes value, optionally narrowed by value constraints.
- [Link schema](./link-schema.md) (`schema/link-schema`): The variant for a link (a CID), which can name the type it expects to point at.
- [Include schema](./include-schema.md) (`schema/include-schema`): The variant for a reference, which is a bare include or, when it carries refinements, an extension.
- [Union schema](./anyof.md) (`schema/anyof`): The variant for a union, which accepts a value that matches any one of the schemas listed under anyOf.
- [Variable Schema](./var-schema.md) (`schema/var-schema`): A type-variable reference, written { "var": "\<name>" }, that matches whatever a generic's parameter is bound to.
- [Literal Schema](./literal-schema.md) (`schema/literal-schema`): The variant for a literal, which is a schema that accepts exactly one value and can describe what that value means.
- [Property](./property.md) (`schema/property`): One field of a struct, holding its value schema, whether a value must include it, and a description of what it is for.

# Examples

The library also holds thirty-two teaching schemas and five instance documents under `example/`. [Examples](../example.md) lists them, grouped by the feature each one shows.

# See also

- [Hypermedia Schemas](../schema.md): what a schema is, and where each topic lives.
- [The data model](./data-model.md): the nine kinds behind the value types.
- [Network blobs](./blobs.md): how the protocol types fit together.
- [Blocks](../protocol/blocks.md): the block tree as a protocol concept.
- [Examples](../example.md): the example schemas and instances.
- [The schema library pipeline](./library-pipeline.md): how the library is validated, pinned and published.
