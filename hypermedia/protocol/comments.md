---
name: Comments
summary: A comment is a small signed record that anyone can attach to a document, and this page explains how comments are named, edited, deleted, threaded and shown, and why nobody can moderate them.
---
A **comment** is a short signed note attached to a [document](./documents.md). Anyone with a [key](./identity.md) can comment on any Hypermedia document, from any node. They do not need to ask the document's owner.

A comment is a small signed [blob](./blobs.md). It names the document and the [version](./documents.md) it is about. It carries a tree of [blocks](./blocks.md), like a document body. It can also reply to another comment. This page explains how comments are named, edited, threaded and found. <!-- id:9CBB-Y-R -->

# The comment blob <!-- id:YFtkPlBl -->

A [comment](../comment.md) is a signed [blob](../blob.md) of type `Comment`. Each version of a comment is a whole copy, called a snapshot. An edit publishes a new blob that replaces the old one. Documents work differently: they are built from a chain of [Changes](../change.md). <!-- id:E9aFqWno -->

A comment names its target (`space`, `path` and `version`), its thread (`threadRoot` and `replyParent`) and a `body` of blocks. When an agent key signs for an account, `account` names that account. The `space` is the [space](./spaces.md) the document lives in. The [comment](../comment.md) type page lists the fields.

The [daemon](../software/daemon.md) checks the signature. Then it indexes the target as a link, the thread links, every link inside the body, and one full-text row per block. Anyone may comment under their own signer, so there is no [permission](./permissions.md) to comment. When `account` differs from `signer`, the daemon also requires an `AGENT` capability from that account to the signer. That lets the signer speak for the account. It is not a permission to comment on the target. <!-- id:l9Egj3kZ -->

# Identity, edits and deletion <!-- id:5XBqDd2P -->

A comment's lasting name is `<authority>/<tsid>`. The authority is the signed `account` [principal](../principal.md) when present, and the signer otherwise. The [TSID](./blobs.md) is an id of 14 or 15 characters that includes a time. The first version of a comment makes its TSID from its own bytes. An edit or a tombstone carries that TSID in its `id` field. So all versions share one name, and each version has its own [CID](../cid.md). <!-- id:6hZOUU7j -->

Among the blobs that share an authority and a TSID, the live version is the one with the newest timestamp. On a tie, the blob whose hash digest has the greatest first 8 bytes wins, so every node picks the same one whatever order the blobs arrived in. A blob with an empty `body` is a tombstone: it marks the comment as deleted, and listings stop showing it. The history stays, and `ListCommentVersions` returns every version that is not a tombstone. <!-- id:aFKTvLqM -->

The name includes the authority. So a lookup by `<authority>/<tsid>`, or a list of its versions, matches only blobs indexed for that authority. Agent keys that may speak for the account can edit one account comment without changing its address. A blob from an unrelated key that only claims the same authority and TSID is rejected. Older blobs without `account` belong to the signer, so delegated edits made before the field existed are not merged. <!-- id:3DG_MVv8 -->

A comment's address is `hm://<authority>/<tsid>`. It always shows the newest version. Add `?v=<comment cid>` to pin one edit. The daemon's link indexer also reads an older form, `hm://c/<cid>`, but the apps never write it. On a [site](./sites.md), a comment appears under its target as `https://site/<path>/:comments/<authority>/<tsid>`. [URLs](./urls.md) has the full grammar. <!-- id:-vALY0pB -->

# Threads and discussions <!-- id:bVkM7Gif -->

A comment with no `threadRoot` starts a discussion. A reply names the first comment of the discussion in `threadRoot`, and the comment it answers in `replyParent`. When those are the same comment, the reply leaves `replyParent` out. A reply must carry `threadRoot`, or the daemon rejects it. A reply can arrive before its root or its parent. Then the daemon sets it aside and indexes it as soon as the missing comment arrives. So [sync](./network.md) in any order never loses a reply. <!-- id:FCAV5TVn -->

Clients group comments by thread. In the [Seed API](../build/web-api.md), `ListDiscussions` returns each root with its replies. The `Comments` [embed](./blocks.md) view shows a document's discussion inside another document. A reader app may show a thread as a tree, or as a flat list ordered by time. Both views read the same three fields. <!-- id:D9AtObRh -->

# Which version was commented on <!-- id:LsYkU2Mr -->

A comment records the document version its author saw, and reader apps show it under that version. Through that version, the daemon ties the comment to the document's [genesis](./documents.md) Change, the first Change of the document. Every head in a compound version must belong to the same document genesis, and a version that spans different genesises is invalid. When a comment arrives before the Changes its `version` names, the daemon stashes it and indexes it once they have all arrived, the same way it waits for a [Ref](../ref.md)'s heads. So comment counts and the latest-comment pointer survive when a document is moved or republished. The path can change, but the genesis cannot. A comment must name a version: one with an empty `version` names no document, so the daemon treats it as invalid and never indexes it. <!-- id:dL9bVnSR -->

# Block and range comments <!-- id:5aP3qCir -->

You can comment on one block, or on a selection of text inside it. To do that, a client wraps the comment body in an [Embed](../block/embed.md) block. The embed's link is the target with a fragment:

- [`hm://<space>/<path>?v=<version>#<blockId>`](./urls.md) for a block,
- `#<blockId>[start:end]` for a range of its text, counted in Unicode code points.

The link pins the version on purpose. A later edit could move the offsets, and the pin makes the quote always show the text the author selected. The comment's own text follows as the embed's children. <!-- id:CnmVx8g9 -->

The quote is a normal link inside the body, so the daemon indexes it like any other link. A block comment then shows up as a [citation](./links-and-citations.md) of that block. The `InteractionSummary` request reports comment counts and citation counts for each block. The app uses them to mark commented blocks in the margin. A block's citation count is one per citing block. So a paper that cites one bibliography entry from four paragraphs shows 4 on that entry. Its comment count is one per comment. <!-- id:gTlHuE6Q -->

# Mentions and citations

A comment body can link, embed and mention, like a document body. The daemon indexes every such link as a citation. A mention of an account notifies that person and can wake a [Seed Agent](../agent.md). [Links and citations](./links-and-citations.md) covers the index, backlinks and how to write a mention.

# Visibility <!-- id:ssv4avsM -->

A comment carries its own [visibility](./privacy.md). Clients copy the target's visibility: they set `Private` when the comment is on a private document. A private comment is visible in two spaces, the author's and the target's.

- Over [peer](./network.md) sync, the comment goes to a peer that proved it is either account, a [WRITER](./permissions.md) in either space, or the [site](./sites.md) server of either space.
- On a hosted site, the comment API checks access to the document's space, so it can refuse the comment's own author.
- A raw `/ipfs` read is allowed if the reader has access to either space.

The comment passes its visibility on to the [file](./files.md) blobs it links, such as attached images, and to nothing else. [Privacy](./privacy.md) has the read rules. <!-- id:7ostaq12 -->

# No moderation <!-- id:NKZMUR_g -->

Nothing checks whether a key may comment. Any key can publish a comment on any document, and a node that syncs the document syncs its comments. So a site owner cannot silence a reply on their own page. There is also no moderation. A site owner cannot hide or remove someone else's comment, and comment spam appears on public sites. Two [metadata](../metadata.md) keys limit what a site shows:

- `showActivity` hides a document's activity panel.
- `showConversations` on a space's [home document](./spaces.md) turns conversations off. <!-- id:wjxwUttn -->

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

- Bodies are markdown. The CLI turns them into blocks with the same rules it uses for documents. See the [Seed CLI](../build/cli.md). A web URL of a comment page works wherever an id is accepted. <!-- id:0QKqiv4X -->
- `createComment`, `updateComment` and `deleteComment` in the [SDK](../build/sdk.md) build the signed blob on the client and return the blobs for `client.publish`. `createComment` takes the target id and version, optional `replyCommentVersion` and `rootReplyCommentVersion`, an optional `quoting` target with a block id and code-point range, and a visibility. Signing works as it does for every blob: encode with the signature set to zeros, sign, fill in the signature, encode again. See the [SDK](../build/sdk.md). <!-- id:PaBid4Il -->
- On the [Seed API](../build/web-api.md), `Comment`, `ListComments` and `ListDiscussions` read comments, and `PublishBlobs` stores a comment the SDK signed.
- The [read](../agent/read.md) verb accepts `hm://<doc>/:comments` for a whole discussion and `hm://<author>/<tsid>` for one comment with its thread, and returns a ready reply call. The [write](../agent/write.md) verb with `options.action: "comment"` posts a comment on a target, with `replyTo` for a reply. `comment.update` edits a comment and `comment.delete` publishes a tombstone. [Seed Agents](../agent.md) start on `document-comment` and `user-mention` [triggers](../trigger.md), so a mention of an agent in a comment calls it. External agents use the CLI commands above. [Using Seed from your own agent](../build/agents.md) covers keys and attribution. <!-- id:voFhcUN4 -->

# See also <!-- id:ACaA2zth -->

- [Blocks](./blocks.md): the body of a comment and block fragments. <!-- id:BhQTgF2X -->
- [Documents](./documents.md): what a comment targets. <!-- id:brAnNt8t -->
- [Links and citations](./links-and-citations.md): citations, backlinks and mentions.
- [URLs](./urls.md): comment addresses. <!-- id:GsYNlv3h -->
- [Permissions](./permissions.md): why no permission covers comments. <!-- id:MWmT1tHV -->
- [Contacts](./contacts.md): filtering comments by who you know.
- [Privacy](./privacy.md): private comments. <!-- id:tbG2ruHD -->
- [Identity](./identity.md): who signs a comment. <!-- id:hWXQM6-W -->
- Schema pages: [comment](../comment.md), [block/comment](../block/comment.md). <!-- id:TBI2OJDj -->
- [Seed API](../build/web-api.md): `ListComments`, `ListDiscussions`, `ListCitations`. <!-- id:OVYCeTHL -->
