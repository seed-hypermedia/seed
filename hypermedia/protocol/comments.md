---
name: Comments
summary: Comments are signed snapshot blobs that target a document version; this page covers their identity, edits and deletion, threads, block and range comments, citations, mentions, visibility and the open question of moderation.
---
Anyone with a key can comment on any Hypermedia document, from any node, without asking the document's owner. A comment is a small signed blob that names the document and version it is about, carries a tree of blocks like a document body, and can reply to another comment. This page explains how comments are identified, edited, threaded and found.

# The comment blob

A [comment](../comment.md) is a signed [blob](../blob.md) of type `Comment`. Unlike a document, it is not built from a chain of Changes: each version of a comment is a whole snapshot, and an edit publishes a new blob that replaces the old one.

| key | meaning |
| --- | --- |
| `signer`, `ts`, `sig` | the envelope every blob carries: who wrote it and when |
| `space`, `path` | the document it targets; `space` is omitted when it equals the signer |
| `version` | the CIDs of the document heads the author was looking at; empty means "the document at this path" |
| `threadRoot` | the CID of the first comment of the thread; present on every reply |
| `replyParent` | the CID of the comment this one replies to; omitted when it equals `threadRoot` |
| `body` | a list of [comment blocks](../block/comment.md): a block plus its children, recursively |
| `id` | present only on an edit or a deletion: the TSID of the comment being replaced |
| `visibility` | `""` for public, `Private` for private |
| `capability` | deprecated and ignored; old blobs may carry it |

The daemon verifies the signature, then indexes the target as a link, the thread links, every link inside the body, and a full-text row per block. It does not check whether the signer is allowed to comment; there is no such permission.

# Identity, edits and deletion

A comment's stable identity is `<author>/<tsid>`. The author is the signer's principal. The TSID is a timestamped id: 10 bytes, a 48-bit millisecond timestamp followed by the first 4 bytes of the SHA-256 of the blob, encoded base58btc into 14 or 15 characters. The first version of a comment derives its TSID from its own bytes; an edit or a tombstone carries that TSID in its `id` field, so all versions share one identity while each has its own CID.

Among the blobs that share a TSID, the live version is the one with the greatest timestamp, with the CID as a tie-break. A blob with an empty `body` is a tombstone: the comment is deleted, and listings stop showing it. The history is kept, and `ListCommentVersions` returns every version.

Because identity includes the signer, only the account that wrote a comment can edit or delete it. The daemon keys the record by the signing account, so a blob from another key with the same TSID is a different record, not an edit.

There are two ways to link to a comment. `hm://<author>/<tsid>` is the comment itself, whatever its current version. `hm://c/<cid>` is one specific version. On a site, a comment appears under its target as `https://site/<path>/:comments/<author>/<tsid>`; the [URLs](./urls.md) page has the full grammar.

# Threads and discussions

A comment with no `threadRoot` starts a discussion. A reply names the discussion's first comment in `threadRoot` and the comment it answers in `replyParent`; when those are the same, `replyParent` is left out. A reply must carry `threadRoot`, or the daemon rejects it. When a reply arrives before its root or parent, the daemon stashes it and indexes it as soon as the missing comment lands, so out-of-order sync never loses a reply.

Clients group comments by thread. The Seed API's `ListDiscussions` returns each root with its replies, and the `Comments` embed view shows a document's discussion inside another document. Readers may show a thread as a tree or flattened by time; both are views of the same three fields.

# Which version was commented on

A comment records the document version its author saw, and readers show it under that version. The daemon resolves the comment to the document's genesis Change through that version, which is why comment counts and the latest-comment pointer survive a document being moved or republished: the path can change, the genesis cannot. A comment whose `version` is empty attaches to whatever document currently lives at the path.

# Block and range comments

To comment on one block, or on a selection inside it, a client wraps the comment body in an [Embed](../block/embed.md) block whose link is the target with a fragment: `hm://<space>/<path>?v=<version>#<blockId>` for a block, or `#<blockId>[start:end]` for a range of its text in Unicode code points. The version is pinned on purpose. A later edit could move the offsets, so the quote always shows the text the author selected. The comment's own text follows as the embed's children.

Because the quote is an ordinary link inside the body, the daemon indexes it like any other link. A block comment therefore shows up as a citation of that block, and the `InteractionSummary` request reports per-block comment and citation counts that the app uses to mark commented blocks in the margin.

# Citations and backlinks

Every `hm://` link the daemon meets while indexing, in a document block, in an annotation, or in a comment body, becomes a link record from the source blob to the target resource, tagged with the source block, the fragment and the version. A pinned version marks the link as exact; a link that follows the latest marks its version as a suggested minimum. `ListCitations` on a target returns these records as [citations](../rpc/type/citation.md), ordered by when the citing blob arrived locally rather than by its claimed time, so a late-arriving old blob can never hide a newer citation on the next page. Four links from one version count as four citations.

The older `ListEntityMentions` call is deprecated; use `ListCitations`.

# Mentions

A mention is an inline embed: an `Embed` annotation over a placeholder character in a block's text, with `mentionKind` set to `account` or `document` and the link pointing at the person or the page. It is the same mechanism in documents and comments, described on [Blocks](./blocks.md). The daemon indexes the mention as a link from the comment to the account, which is how "mentions of me" is computed and how a Seed Agent's mention trigger fires. The `MentionCandidates` request ranks who or what to suggest while you type.

# Visibility

A comment carries its own visibility and, by convention, inherits its target's: clients set `Private` when commenting on a private document. A private comment is readable by its author and by the target space's owner, and it never propagates visibility to anything else. Private documents are themselves an evolving feature; [Privacy](./privacy.md) has the current state.

# Anyone can comment; nobody can moderate yet

Comments are not authorization-checked. Any key can publish a comment on any document, and a node that syncs the document syncs its comments. The upside is that no site owner can silence a reply on their own page. The downside is that there is no moderation: a site owner cannot hide or remove someone else's comment today, and comment spam has been observed on public sites. Removing or revoking comments is on the team's launch list and not built as of September 2026. Until it ships, the mitigations are thin: a document can hide its activity panel with the `showActivity` metadata key, and the web of trust described on [Permissions](./permissions.md) is the intended long-term filter.

# Working with comments

## In the Seed app

Open a document's discussion from the comments panel, reply inside a thread, or select text and comment on it to create a range comment. Your own comments show edit and delete actions. The app signs comments with your account key, or with a linked device key on a linked device.

## CLI

```sh
seed-cli comment list hm://<space>/<path>              # every comment on a document
seed-cli comment discussions hm://<space>/<path>       # grouped into threads
seed-cli comment get <author>/<tsid>
seed-cli comment create hm://<space>/<path> --body "Nice." --key mykey
seed-cli comment create 'hm://<space>/<path>#<blockId>' --file reply.md   # a block comment
seed-cli comment create hm://<space>/<path> --reply <author>/<tsid> --body "Agreed."
seed-cli comment edit <author>/<tsid> --body "Edited."
seed-cli comment delete <author>/<tsid>                 # publishes a tombstone
```

Bodies are markdown, parsed into blocks with the same dialect documents use. A web URL of a comment page works wherever an id is accepted.

## SDK

`createComment`, `updateComment` and `deleteComment` in the SDK build the signed blob on the client and return the blobs for `client.publish`. `createComment` takes the target id and version, optional `replyCommentVersion` and `rootReplyCommentVersion`, an optional `quoting` target with a block id and code-point range, and a visibility. The signing pattern is the one every blob uses: encode with the signature zeroed, sign, fill, encode. See [the SDK](../build/sdk.md).

## Web API

| request | what it returns |
| --- | --- |
| `Comment` | one comment by `<author>/<tsid>` |
| `ListComments` | every comment on a target, with the authors' metadata |
| `ListDiscussions` | the same comments grouped into threads, plus discussions on other documents that cite this one |
| `ListCommentsByReference` | comments elsewhere that quote or link this document |
| `ListCommentsByAuthor`, `ListCommentVersions`, `GetCommentReplyCount` | by author, edit history, reply count |
| `ListCitations` | every link record pointing at a resource |
| `InteractionSummary` | counts of comments, citations, changes and children, per document and per block |

Publishing goes through `PublishBlobs` with a blob the SDK signed. The daemon's gRPC `Comments` service offers `CreateComment`, `UpdateComment` and `DeleteComment` signed with a key the daemon holds. All of it is catalogued on [the Seed API](../build/web-api.md).

## Agents

The [read](../agent/read.md) verb accepts `hm://<doc>/:comments` for a whole discussion and `hm://<author>/<tsid>` for one comment with its thread, and returns a ready reply call. The [write](../agent/write.md) verb with `options.action: "comment"` posts a comment on a target, with `replyTo` for a reply; `comment.update` and `comment.delete` edit and tombstone. Agents fire on `document-comment` and `user-mention` triggers, which is how mentioning an agent in a comment summons it. External agents use the CLI commands above; [Building with agents](../build/agents.md) covers keys and attribution.

# Where this is going

As of September 2026 the open items are moderation (an owner revoking or hiding comments on their documents), human-friendly comment URLs under the target's namespace, reactions (designed, then put on hold), and notifications that recognize an edit as an edit rather than a new comment.

# See also

[Blocks](./blocks.md), [Documents](./documents.md), [URLs](./urls.md), [Privacy](./privacy.md), [Identity](./identity.md), the schema pages [comment](../comment.md) and [block/comment](../block/comment.md), and the API pages [rpc/list-comments](../rpc/list-comments.md), [rpc/list-discussions](../rpc/list-discussions.md), [rpc/list-citations](../rpc/list-citations.md).
