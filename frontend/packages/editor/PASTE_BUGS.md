# Paste Bugs

## Architecture

Paste handling lives in `BlockChildren.ts` `transformPasted` hook + `normalizeFragment.ts`.

ProseMirror's DOMParser produces **flat** slices from HTML (headings, paragraphs, lists as siblings), but our schema expects **nested** structure (`blockNode > [blockContent, blockChildren?]`). `normalizeFragment` restructures the flat fragment into our schema.

The `Slice(content, openStart, openEnd)` values control how PM merges pasted content:
- `openStart/openEnd > 0` — PM merges into existing document structure (can cause extra nesting)
- `openStart/openEnd = 0` — PM inserts as-is (can create new top-level blocks)

## Known Bugs

### 1. Images duplicated at top on web page paste

**Repro:**
1. `cmd+a` on https://worrydream.com/EarlyHistoryOfSmalltalk/
2. Paste into a Seed document
3. Images appear duplicated at the top

**Example:** https://gabo.es/private-notes/the-early-history-of-smalltalk

**Likely cause:** TBD — could be `transformPastedHTML` handling or duplicate image nodes in the parsed slice.

### 2. Paste adds extra indentation levels

**Repro:**
1. Open https://seedteamtalks.hyper.media/human-interface-library/user-testing-round-ii in desktop app
2. Cut a group of blocks
3. Paste at the bottom of the document
4. New wrapper blocks are created instead of pasting content at cursor level

**Likely cause:** `openStart: 0, openEnd: 0` forces PM to insert the slice as a complete structure rather than merging into the existing position. When cutting from within a nested structure, the slice has `openStart/openEnd > 0` indicating it came from a deep position. Zeroing them out tells PM "this is top-level content", so it wraps everything in new blockNodes.

### 3. Orphan blockChildren creates empty paragraph wrapper

**Context:** When pasting HTML with `<h2>` followed by `<ul>`, PM parses them as siblings. `normalizeFragment` correctly merges `blockChildren` into the preceding `blockNode`. But when a `blockChildren` has NO preceding `blockNode`, it wraps it in `blockNode(emptyParagraph, blockChildren)`.

**Problem:** Hard to distinguish between:
- Orphan `blockChildren` that needs wrapping (empty paragraph is structural, should be invisible)
- A `blockNode` that genuinely has an empty paragraph followed by children

**Possible fix:** Track whether the empty paragraph was synthesized by normalizeFragment vs present in the original paste content. Could use a node attribute or handle this in `transformPasted` by checking the original slice structure.

## Slice Structure Reference

Example parsed slice from pasting a web page with headings + lists:

```
Fragment (flat — this is the problem):
  heading "Abstract"
  paragraph "Most ideas..."
  heading "Table of Contents"
  blockChildren(Unordered)        <-- orphan, should be child of preceding blockNode
    blockNode(paragraph "Item 1")
    blockNode(paragraph "Item 2")
      blockChildren(Unordered)    <-- correctly nested
        blockNode(paragraph "Sub-item")
  paragraph "Some text"
```

After `normalizeFragment`:

```
Fragment (nested — matches our schema):
  blockNode
    heading "Abstract"
  blockNode
    paragraph "Most ideas..."
  blockNode
    heading "Table of Contents"
    blockChildren(Unordered)      <-- merged into preceding blockNode
      blockNode(paragraph "Item 1")
      blockNode(paragraph "Item 2")
        blockChildren(Unordered)
          blockNode(paragraph "Sub-item")
  blockNode
    paragraph "Some text"
```
