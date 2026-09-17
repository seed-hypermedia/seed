---
name: Comments
summary: Comments are signed snapshot blobs that target a document version, and this page covers their identity, edits and deletion, threads, block and range comments, citations, mentions, visibility and the open question of moderation.
---
Anyone with a [key](./identity.md) can comment on any Hypermedia [document](./documents.md), from any node, without asking the document's owner. A comment is a small signed [blob](./blobs.md). It names the document and [version](./documents.md) it is about, carries a tree of [blocks](./blocks.md) like a document body, and can reply to another comment. This page explains how comments are identified, edited, threaded and found. <!-- id:9CBB-Y-R -->

# The comment blob <!-- id:YFtkPlBl -->

A [comment](../comment.md) is a signed [blob](../blob.md) of type `Comment`. Each version of a comment is a whole snapshot. An edit publishes a new blob that replaces the old one. Documents work differently: they are built from a chain of [Changes](../change.md). <!-- id:E9aFqWno -->

<!-- id:lZeNI6EG -->
| key <!-- col:fYfV8Z9P --> | meaning <!-- col:OBQZ_Koi --> <!-- id:yLoNYlB6 --> |
| --- | --- |
| `signer`, `ts`, `sig` | the envelope every blob carries: who wrote it and when <!-- id:3AvWahqt --> |
| `space`, `path` | the document it targets; `space` is omitted when it equals the signer <!-- id:kYYrayoz --> |
| `version` | the CIDs of the document heads the author was looking at; empty means "the document at this path" <!-- id:X2-9MteI --> |
| `threadRoot` | the CID of the first comment of the thread; present on every reply <!-- id:nUJmFMVQ --> |
| `replyParent` | the CID of the comment this one replies to; omitted when it equals `threadRoot` <!-- id:VnwV6eo_ --> |
| `body` | a list of [comment blocks](../block/comment.md): a block plus its children, recursively <!-- id:f8Cqg5IZ --> |
| `id` | present only on an edit or a deletion: the TSID of the comment being replaced <!-- id:gO4Blmy5 --> |
| `visibility` | `""` for public, `Private` for private <!-- id:ISOBhZJR --> |
| `capability` | deprecated and ignored; old blobs may carry it <!-- id:eJ16dkIA --> |

The daemon verifies the signature, then indexes the target as a link, the thread links, every link inside the body, and a full-text row per block. It does not check whether the signer may comment, because no such [permission](./permissions.md) exists. <!-- id:l9Egj3kZ -->

# Identity, edits and deletion <!-- id:5XBqDd2P -->

A comment's stable identity is `<author>/<tsid>`. The author is the signer's [principal](../principal.md). The [TSID](./blobs.md) is a timestamped id: 10 bytes, a 48-bit millisecond timestamp followed by the first 4 bytes of the SHA-256 of the blob, encoded base58btc into 14 or 15 characters. The first version of a comment derives its TSID from its own bytes. An edit or a tombstone carries that TSID in its `id` field, so all versions share one identity while each has its own CID. <!-- id:6hZOUU7j -->

Among the blobs that share a TSID, the live version is the one with the greatest timestamp. On a tie, the blob the node stored last wins. A blob with an empty `body` is a tombstone. The comment is deleted, and listings stop showing it. The history is kept, and `ListCommentVersions` returns every version. <!-- id:aFKTvLqM -->

Because identity includes the signer, looking up a comment by `<author>/<tsid>`, or listing its versions, matches only blobs signed by that author. A blob from another key that carries the same TSID does not change what that address returns. <!-- id:3DG_MVv8 -->

There are two ways to link to a comment. `hm://<author>/<tsid>` is the comment itself, whatever its current version. `hm://c/<cid>` is one specific version. On a [site](./sites.md), a comment appears under its target as `https://site/<path>/:comments/<author>/<tsid>`. [URLs](./urls.md) has the full grammar. <!-- id:-vALY0pB -->

# Threads and discussions <!-- id:bVkM7Gif -->

A comment with no `threadRoot` starts a discussion. A reply names the discussion's first comment in `threadRoot` and the comment it answers in `replyParent`. When those are the same, `replyParent` is left out. A reply must carry `threadRoot`, or the daemon rejects it. When a reply arrives before its root or parent, the daemon stashes it and indexes it as soon as the missing comment lands. So out-of-order [sync](./network.md) never loses a reply. <!-- id:FCAV5TVn -->

Clients group comments by thread. The [Seed API](../build/web-api.md)'s `ListDiscussions` returns each root with its replies, and the `Comments` [embed](./blocks.md) view shows a document's discussion inside another document. Readers may show a thread as a tree or flattened by time. Both views read the same three fields. <!-- id:D9AtObRh -->

# Which version was commented on <!-- id:LsYkU2Mr -->

A comment records the document version its author saw, and readers show it under that version. The daemon resolves the comment to the document's [genesis](./documents.md) Change through that version. So comment counts and the latest-comment pointer survive when a document is moved or republished. The path can change, but the genesis cannot. A comment whose `version` is empty attaches to whatever document currently lives at the path. <!-- id:dL9bVnSR -->

# Block and range comments <!-- id:5aP3qCir -->

To comment on one block, or on a selection inside it, a client wraps the comment body in an [Embed](../block/embed.md) block whose link is the target with a fragment: [`hm://<space>/<path>?v=<version>#<blockId>`](./urls.md) for a block, or `#<blockId>[start:end]` for a range of its text in Unicode code points. The version is pinned on purpose. A later edit could move the offsets, so the quote always shows the text the author selected. The comment's own text follows as the embed's children. <!-- id:CnmVx8g9 -->

Because the quote is an ordinary link inside the body, the daemon indexes it like any other link. So a block comment shows up as a citation of that block. The `InteractionSummary` request reports per-block comment and citation counts that the app uses to mark commented blocks in the margin. <!-- id:gTlHuE6Q -->

# Citations and backlinks <!-- id:fvUUw6AL -->

Every `hm://` link the daemon meets while indexing becomes a link record from the source blob to the target [resource](../glossary.md). The link can sit in a document [block](./blocks.md), an annotation, or a comment body. The record is, tagged with the source block, the fragment and the version. A pinned version marks the link as exact. A link that follows the latest marks its version as a suggested minimum. `ListCitations` on a target returns these records as [citations](../rpc/type/citation.md), ordered by when the citing blob arrived locally. The order ignores the blob's claimed time, so a late-arriving old blob can never hide a newer citation on the next page. Four links from one version count as four citations. <!-- id:cQdIVT1x -->

The older `ListEntityMentions` call is deprecated. Use `ListCitations`. <!-- id:s094t8hZ -->

# Mentions <!-- id:10Yi4m0f -->

A mention is an inline embed: an `Embed` annotation over a placeholder character in a block's text, with `mentionKind` set to `account` or `document` and the link pointing at the person or the page. Documents and comments use the same mechanism, described in [Blocks](./blocks.md). The daemon indexes the mention as a link from the comment to the [account](./identity.md). This link drives "mentions of me" and the mention [trigger](../agent/triggers.md) of a [Seed Agent](../agent.md). The `MentionCandidates` request ranks who or what to suggest while you type. <!-- id:cs2v6x2r -->

# Visibility <!-- id:ssv4avsM -->

A comment carries its own [visibility](./privacy.md). By convention it copies its target's: clients set `Private` when commenting on a private document. A private comment is visible in two spaces, the author's and the target's. Over [peer](./network.md) sync, the comment goes to peers authenticated as either account, as a [WRITER](./permissions.md) in either space, or as either space's [site](./sites.md) server. On a public-only node, HTTP serves it only to the target space's owner and root-level writers, so that node may refuse the author. Its visibility passes on to the [file](./files.md) blobs it links, such as attached images, and to nothing else. Private documents are still changing. [Privacy](./privacy.md) has the current state. <!-- id:7ostaq12 -->

# No moderation yet <!-- id:NKZMUR_g -->

Nothing checks authorization on comments. Any key can publish a comment on any document, and a node that syncs the document syncs its comments. So no site owner can silence a reply on their own page. There is also no moderation. A site owner cannot hide or remove someone else's comment today, and comment spam has appeared on public sites. Removing or revoking comments is on the team's launch list and is not built as of September 2026. Until then there are two weak mitigations. A document can hide its activity panel with the `showActivity` [metadata](../metadata.md) key. The web of trust described in [Permissions](./permissions.md) is the planned long-term filter. <!-- id:wjxwUttn -->

# Working with comments <!-- id:Q7w6hN8T -->

## In the Seed app <!-- id:GX8eLV0Z -->

Open a document's discussion from the comments panel, reply inside a thread, or select text and comment on it to create a range comment. Your own comments show edit and delete actions. The [Seed app](../apps/desktop.md) signs comments with your account key, or with a linked device key on a linked device. <!-- id:PP4r2i3k -->

## CLI <!-- id:xzAM9y7- -->

```sh <!-- id:9zKlb-OY -->
seed-cli comment list hm://<space>/<path>              # every comment on a document
seed-cli comment discussions hm://<space>/<path>       # grouped into threads
seed-cli comment get <author>/<tsid>
seed-cli comment create hm://<space>/<path> --body "Nice." --key mykey
seed-cli comment create 'hm://<space>/<path>#<blockId>' --file reply.md   # a block comment
seed-cli comment create hm://<space>/<path> --reply <author>/<tsid> --body "Agreed."
seed-cli comment edit <author>/<tsid> --body "Edited."
seed-cli comment delete <author>/<tsid>                 # publishes a tombstone
```

Bodies are markdown, parsed into blocks with the same dialect documents use. See [the CLI guide](../build/cli.md). A web URL of a comment page works wherever an id is accepted. <!-- id:0QKqiv4X -->

## SDK <!-- id:ywTMd76A -->

`createComment`, `updateComment` and `deleteComment` in the [SDK](../build/sdk.md) build the signed blob on the client and return the blobs for `client.publish`. `createComment` takes the target id and version, optional `replyCommentVersion` and `rootReplyCommentVersion`, an optional `quoting` target with a block id and code-point range, and a visibility. The signing pattern is the one every blob uses: encode with the signature zeroed, sign, fill, encode. See [the SDK guide](../build/sdk.md). <!-- id:PaBid4Il -->

## Web API <!-- id:A_leELq1 -->

<!-- id:LKMIcOn3 -->
| request <!-- col:2kqKNJg- --> | what it returns <!-- col:MtrSTRzk --> <!-- id:9vmPqqhx --> |
| --- | --- |
| `Comment` | one comment by `<author>/<tsid>` <!-- id:t5pw26UX --> |
| `ListComments` | every comment on a target, with the authors' metadata <!-- id:1Snj4zjP --> |
| `ListDiscussions` | the same comments grouped into threads, plus discussions on other documents that cite this one <!-- id:5plJM3ss --> |
| `ListCommentsByReference` | comments elsewhere that quote or link this document <!-- id:TLoyOZwr --> |
| `ListCommentsByAuthor`, `ListCommentVersions`, `GetCommentReplyCount` | by author, edit history, reply count <!-- id:pG0tTn4x --> |
| `ListCitations` | every link record pointing at a resource <!-- id:VrmOtJ35 --> |
| `InteractionSummary` | counts of comments, citations, changes and children, per document and per block <!-- id:iTgm-hIh --> |

Publishing goes through `PublishBlobs` with a blob the SDK signed. The daemon's [gRPC](../build/grpc.md) `Comments` service offers `CreateComment`, `UpdateComment` and `DeleteComment` signed with a key the daemon holds. [The Seed API guide](../build/web-api.md) catalogues all of it. <!-- id:xaYPmnLh -->

## Agents <!-- id:lt8vqetB -->

The [read](../agent/read.md) verb accepts `hm://<doc>/:comments` for a whole discussion and `hm://<author>/<tsid>` for one comment with its thread, and returns a ready reply call. The [write](../agent/write.md) verb with `options.action: "comment"` posts a comment on a target, with `replyTo` for a reply. `comment.update` and `comment.delete` edit and tombstone. [Seed Agents](../agent.md) fire on `document-comment` and `user-mention` [triggers](../agent/triggers.md), so mentioning an agent in a comment summons it. External agents use the CLI commands above. [Building with agents](../build/agents.md) covers keys and attribution. <!-- id:voFhcUN4 -->

# Where this is going <!-- id:FPPVrH0P -->

As of September 2026 the open items are moderation (an owner revoking or hiding comments on their documents), human-friendly comment URLs under the target's namespace, reactions (designed, then put on hold), and notifications that treat an edit as an edit instead of a new comment. [Roadmap](./roadmap.md) collects the wider plans. <!-- id:QUWwfnF7 -->

# See also <!-- id:ACaA2zth -->

- [Blocks](./blocks.md): the body of a comment and block fragments. <!-- id:BhQTgF2X -->
- [Documents](./documents.md): what a comment targets.
- [URLs](./urls.md): comment addresses.
- [Permissions](./permissions.md): contacts and the web of trust.
- [Privacy](./privacy.md): private comments.
- [Identity](./identity.md): who signs a comment.
- Schema pages: [comment](../comment.md), [block/comment](../block/comment.md).
- API pages: [rpc/list-comments](../rpc/list-comments.md), [rpc/list-discussions](../rpc/list-discussions.md), [rpc/list-citations](../rpc/list-citations.md).
