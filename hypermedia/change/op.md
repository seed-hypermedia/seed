---
name: Operation
summary: One step inside a Change body, a map tagged by type that sets metadata, replaces a block, moves blocks, or deletes blocks, and the page explains how each op mutates the document.
schemaDefinition: ipfs://bafyreidwovzt73cwk6yypirkavyd65pwdo2ogbuyd2iugpueq4lwuqkwau
---
An operation is the smallest thing a Change can say about a document: set this metadata key, replace this block, put these blocks here, delete those. A Change carries a list of them, and the daemon applies the list in order when it rebuilds the document. <!-- id:XDsfcsVH -->

This page defines the **change/op** union, the discriminated set of operations a [Change body](./body.md) may contain. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:JsOLI17h -->

Every op is a map with a `type` string and, apart from that tag, only the fields its variant defines; an unknown field is a hard error and the whole upload batch is rejected. This is how each variant mutates the document: <!-- id:gEwiUPEo -->
  - [SetAttributes](./op/set-attributes.md) writes [metadata](../metadata.md) by key path. Each key path is a last-writer-wins register; a newer op id overwrites, and setting a nested key removes an older value at its ancestor or descendant paths. `block` must be empty today, so this op only addresses document-level metadata. <!-- id:-pEhVlxh -->
  - [ReplaceBlock](./op/replace-block.md) sets the full state of one [block](../block.md): id, type, text, link, annotations and inline attributes. The newest replacement by op id wins. A block replaced but never positioned is a detached block. <!-- id:Ve6vo-0g -->
  - [MoveBlocks](./op/move-blocks.md) positions a contiguous run of sibling blocks under a parent (empty means the document root) after a reference position (empty means the start). Sibling order is a replicated growable array: concurrent inserts at the same reference are ordered by op id, and for a block moved several times the latest move wins. A move that would make a block its own ancestor is ignored. <!-- id:GFI5Pdik -->
  - [DeleteBlocks](./op/delete-blocks.md) moves blocks to the trash, which is itself a parent in the tree; a later move can bring a block back. <!-- id:dEtKMKeP -->
  - [SetKey](./op/set-key.md) is the deprecated flat form of SetAttributes, still accepted for old Changes. <!-- id:6TXv-L74 -->

Op ids are `(ts, idx, actor)`: the Change's timestamp, the op's position counter, and a number derived from the signer. `MoveBlocks.ref` carries such an id as `[ts, idx, actor]`, or as `[idx]` to mean an op earlier in the same Change. Inside a multi-block op the counter advances by the element's index, a quirk that is now part of the wire format. The full rules are in [Documents](../protocol/documents.md). <!-- id:Hn_s-yee -->

# Shape <!-- id:xCLEKTpg -->

A **union** — a value matches one of these variants: <!-- id:bdgSe4Z4 -->
  - [change/op/set-attributes](./op/set-attributes.md) <!-- id:BP_gB1f4 -->
  - [change/op/move-blocks](./op/move-blocks.md) <!-- id:q_WzwIs6 -->
  - [change/op/replace-block](./op/replace-block.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:DPvyep9M -->
  - [change/op/delete-blocks](./op/delete-blocks.md) <!-- id:PlfgegNY -->
  - [change/op/set-key](./op/set-key.md) <!-- id:HKHLdobn -->

**Generic** over `⟨Block⟩` (default [block](../block.md)). <!-- id:VQIfC_d8 -->

# Depends on <!-- id:BTjLtIcz -->

- [block](../block.md) <!-- id:qhL6R4Ju -->
- [change/op/delete-blocks](./op/delete-blocks.md) <!-- id:I7YcxiFi -->
- [change/op/move-blocks](./op/move-blocks.md) <!-- id:QfAw7guU -->
- [change/op/replace-block](./op/replace-block.md) <!-- id:bKH963tB -->
- [change/op/set-attributes](./op/set-attributes.md) <!-- id:xn-9VfDd -->
- [change/op/set-key](./op/set-key.md) <!-- id:HylY6yqt -->
