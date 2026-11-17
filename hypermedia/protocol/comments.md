---
name: Comments
summary: Comments are signed snapshot blobs that target a document version, and this page covers their identity, edits and deletion, threads, block and range comments, visibility and the lack of moderation.
---
Anyone with a [key](./identity.md) can comment on any Hypermedia [document](./documents.md), from any node, without asking the document's owner. A comment is a small signed [blob](./blobs.md). It names the document and [version](./documents.md) it is about, carries a tree of [blocks](./blocks.md) like a document body, and can reply to another comment. This page explains how comments are identified, edited, threaded and found. <!-- id:9CBB-Y-R -->

# The comment blob <!-- id:YFtkPlBl -->

A [comment](../comment.md) is a signed [blob](../blob.md) of type `Comment`. Each version of a comment is a whole snapshot. An edit publishes a new blob that replaces the old one. Documents work differently: they are built from a chain of [Changes](../change.md). <!-- id:E9aFqWno -->

A comment names its target (`space`, `path` and `version`), its thread (`threadRoot` and `replyParent`) and a `body` of blocks. The [comment](../comment.md) type page is the reference for the fields.

The daemon verifies the signature, then indexes the target as a link, the thread links, every link inside the body, and a full-text row per block. It does not check whether the signer may comment, because no such [permission](./permissions.md) exists. <!-- id:l9Egj3kZ -->

# Identity, edits and deletion <!-- id:5XBqDd2P -->

A comment's stable identity is `<author>/<tsid>`. The author is the signer's [principal](../principal.md). The [TSID](./blobs.md) is a timestamped id of 14 or 15 characters. The first version of a comment derives its TSID from its own bytes. An edit or a tombstone carries that TSID in its `id` field, so all versions share one identity while each has its own CID. <!-- id:6hZOUU7j -->

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

Because the quote is an ordinary link inside the body, the daemon indexes it like any other link. So a block comment shows up as a [citation](./links-and-citations.md) of that block. The `InteractionSummary` request reports per-block comment and citation counts that the app uses to mark commented blocks in the margin. A block's citation count is one per citing block, so a paper that cites one bibliography entry from four paragraphs shows 4 on that entry; its comment count is one per comment. <!-- id:gTlHuE6Q -->

# Mentions and citations

A comment body can link, embed and mention like a document body. The daemon indexes every such link as a citation. A mention of an account notifies that person and can wake a [Seed Agent](../agent.md). [Links and citations](./links-and-citations.md) covers the index, backlinks and the mention syntax.

# Visibility <!-- id:ssv4avsM -->

A comment carries its own [visibility](./privacy.md). By convention it copies its target's: clients set `Private` when commenting on a private document. A private comment is visible in two spaces, the author's and the target's. Over [peer](./network.md) sync, the comment goes to peers authenticated as either account, as a [WRITER](./permissions.md) in either space, or as either space's [site](./sites.md) server. Server-mode comment RPCs authorize against the target space, so they may refuse the author. Raw `/ipfs` reads authorize against either of the comment blob's visibility spaces. Its visibility passes on to the [file](./files.md) blobs it links, such as attached images, and to nothing else. [Privacy](./privacy.md) has the read rules. <!-- id:7ostaq12 -->

# No moderation <!-- id:NKZMUR_g -->

Nothing checks authorization on comments. Any key can publish a comment on any document, and a node that syncs the document syncs its comments. So no site owner can silence a reply on their own page. There is also no moderation. A site owner cannot hide or remove someone else's comment, and comment spam appears on public sites. Two [metadata](../metadata.md) keys limit what a site shows: `showActivity` hides a document's activity panel, and `showConversations` on a space's home document turns conversations off. <!-- id:wjxwUttn -->

# Working with comments <!-- id:Q7w6hN8T -->

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

- Bodies are markdown, parsed into blocks with the same dialect documents use. See [the CLI guide](../build/cli.md). A web URL of a comment page works wherever an id is accepted. <!-- id:0QKqiv4X -->
- `createComment`, `updateComment` and `deleteComment` in the [SDK](../build/sdk.md) build the signed blob on the client and return the blobs for `client.publish`. `createComment` takes the target id and version, optional `replyCommentVersion` and `rootReplyCommentVersion`, an optional `quoting` target with a block id and code-point range, and a visibility. The signing pattern is the one every blob uses: encode with the signature zeroed, sign, fill, encode. See [the SDK guide](../build/sdk.md). <!-- id:PaBid4Il -->
- On the [Seed API](../build/web-api.md), `Comment`, `ListComments` and `ListDiscussions` read comments, and `PublishBlobs` stores a comment the SDK signed.
- The [read](../agent/read.md) verb accepts `hm://<doc>/:comments` for a whole discussion and `hm://<author>/<tsid>` for one comment with its thread, and returns a ready reply call. The [write](../agent/write.md) verb with `options.action: "comment"` posts a comment on a target, with `replyTo` for a reply. `comment.update` and `comment.delete` edit and tombstone. [Seed Agents](../agent.md) fire on `document-comment` and `user-mention` [triggers](../agent/triggers.md), so mentioning an agent in a comment summons it. External agents use the CLI commands above. [Building with agents](../build/agents.md) covers keys and attribution. <!-- id:voFhcUN4 -->

# See also <!-- id:ACaA2zth -->

- [Blocks](./blocks.md): the body of a comment and block fragments. <!-- id:BhQTgF2X -->
- [Documents](./documents.md): what a comment targets. <!-- id:brAnNt8t -->
- [Links and citations](./links-and-citations.md): citations, backlinks and mentions.
- [URLs](./urls.md): comment addresses. <!-- id:GsYNlv3h -->
- [Permissions](./permissions.md): contacts and the web of trust. <!-- id:MWmT1tHV -->
- [Privacy](./privacy.md): private comments. <!-- id:tbG2ruHD -->
- [Identity](./identity.md): who signs a comment. <!-- id:hWXQM6-W -->
- Schema pages: [comment](../comment.md), [block/comment](../block/comment.md). <!-- id:TBI2OJDj -->
- [Seed API](../build/web-api.md): `ListComments`, `ListDiscussions`, `ListCitations`. <!-- id:OVYCeTHL -->
