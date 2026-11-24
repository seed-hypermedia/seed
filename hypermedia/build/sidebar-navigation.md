---
name: Sidebar Navigation
summary: How the document sidebar is built from published Cards alone, while paths keep defining document locations.
---

# Published Cards define navigation

The [document](../protocol/documents.md) sidebar is built from [Card embeds](../block/embed-view.md), and Query blocks that act as Cards, and nothing else. It starts at the [space](../protocol/spaces.md)'s home document and reads Card embeds from the latest published version of each visible page, in document order. A row can be expanded when its page has Cards, and expanding it shows them. A row expands on its own when one of its Cards is the open page. Cards nested inside authored [blocks](../protocol/blocks.md) also participate. Repeated Cards for the same document produce one row per parent, at the first occurrence.

A Card can point to another path or another space. Its position in the sidebar does not change its path. Only Cards that follow the latest version count: a link with no `v`, or with both `v` and `l`. A Card pinned to a version (`v` without `l`) never appears in the sidebar; a later latest Card to the same document still places it. The sidebar always opens the latest version of the whole target document, even when the Card points at a block. A [Query block](../block/query.md) with exactly one include that names a non-empty path counts as a Card to the document at that path, in the include's space or, when the include names none, the space of the document holding the block. A Query of the holding document's own children, of a space's root, or with several includes adds nothing. Content embeds, inline links, and the individual query results do not become navigation rows. Unpublished edits do not change published navigation.

Cycles stop at an ancestor already present in the current branch. The same document can still appear under different parents. Rows follow moved documents to their new address; republished documents keep their republished address.

# Paths and drafts

Paths continue to define document locations, breadcrumbs, creation destinations, move destinations, and schema inheritance, but they play no part in the sidebar. The sidebar never lists a page's path children, never counts them, and never links to a path's directory. A document can appear under a sidebar row whose path is different from its actual parent, and a published document that no Card reaches does not appear in navigation at all. Breadcrumbs and destination dialogs continue to show the actual path.

Creating a child still uses the selected document's path. The existing publication worker can append a Card to its path parent. It skips that addition if the parent already references the child or has a query covering its children. Moves continue to use the existing redirect and Card maintenance flows. A change to the Cards can rearrange navigation without moving any document.

Sidebar search is a flat title search over the published pages of the current space, so it also finds pages that no Card reaches. It is not part of the navigation tree. New unpublished drafts appear in a separate **Drafts** list, including drafts under parents absent from navigation.

# Data loading

The indexer derives each published document's navigation Cards when it indexes a [Ref](../ref.md), in the same replay that derives its collection shape, and the documents API returns them as `navigation_cards` on `DocumentInfo`. A sidebar row reads only that document info, which also carries the title and kind, so the sidebar never loads a document. Only the backend decides which blocks are Cards; the frontend reads its list. When the info of a moved or republished address is a redirect, the row reads the info of the redirect's target instead, by the same rules as the document resolver: a move opens the target, a republish keeps its own address, and a cyclic chain or one longer than five hops shows the row as unavailable.

Rows read without subscribing, so opening the sidebar starts no discovery or sync; the app already keeps followed spaces in sync. Descendants of collapsed rows do not mount. The sidebar runs no directory listing; the space-wide listing behind search runs only while the search box holds a query.

If a document cannot be loaded, the sidebar shows a retry action. It does not interpret a failed request as an empty published document.
