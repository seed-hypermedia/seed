---
name: Navigation item
summary: "One entry of a site's navigation menu: a Link block with display text and a link, stored as a child of the detached navigation block."
schemaDefinition: ipfs://bafyreiexmspnzsukur3eskmrf7e6t7rxaeky6xf67ikcoysjtz4dcrp4ia
---
A **navigation item** is one entry of a [site](../protocol/sites.md)'s menu. The menu is a detached block named `navigation`: a [block](../block.md) with state but no position in the content tree. It is neither [metadata](../metadata.md) nor part of the body. Each of its children is one of these `Link` blocks: `text` is the label and `link` is an `hm://` or web URL. The Seed app edits the menu in a site's settings, and the daemon returns it in the document's detached blocks. See [Blocks](../protocol/blocks.md).

# Shape <!-- id:dvycGapW -->

A **closed struct** with these fields: <!-- id:Mu8YSSfc -->
  - `type` _(required)_: `"Link"` <!-- id:Q8-nnpcx -->
  - `id` _(required)_: [string](../string.md) <!-- id:WEDCihgA -->
  - `text` _(required)_: [string](../string.md) <!-- id:rF9qJUPE -->
  - `link` _(required)_: [string](../string.md) <!-- id:9jmT0dlV -->

# Depends on <!-- id:jX5d4-tm -->

- [string](../string.md) <!-- id:vc-qjhSN -->

# See also

- [Blocks](../protocol/blocks.md): detached blocks and navigation.
- [Sites](../protocol/sites.md): the site the menu belongs to.
- [metadata](../metadata.md): the document's attributes.
- [ReplaceBlock](../change/op/replace-block.md): how detached blocks are written.
- [URLs](../protocol/urls.md): what a menu link can point at.
