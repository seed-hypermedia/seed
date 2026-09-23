---
name: Navigation item
summary: "One entry of a site's navigation menu: a Link block with display text and a link, stored as a child of the detached navigation block."
---
A **navigation item** is one entry of a [site](../protocol/sites.md)'s menu. The menu is a detached block named `navigation`: a [block](../block.md) with state but no position in the content tree. It is neither [metadata](../metadata.md) nor part of the body. Each of its children is one of these `Link` blocks: `text` is the label and `link` is an `hm://` or web URL. The Seed app edits the menu in a site's settings, and the daemon returns it in the document's detached blocks. See [Blocks](../protocol/blocks.md). <!-- id:9-mJuCfi -->

# See also <!-- id:4pqsVOfl -->

- [Blocks](../protocol/blocks.md): detached blocks and navigation. <!-- id:TM-XkTLR -->
- [Sites](../protocol/sites.md): the site the menu belongs to. <!-- id:BHOjOPAk -->
- [metadata](../metadata.md): the document's attributes. <!-- id:MI16VfI0 -->
- [ReplaceBlock](../change/op/replace-block.md): how detached blocks are written. <!-- id:z_C8I4qq -->
- [URLs](../protocol/urls.md): what a menu link can point at. <!-- id:QAuOhHZD -->
