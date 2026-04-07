## Problem Statement

The editor on main uses BlockNote's original schema:

blockGroup — wraps child blocks (renders <div>)

blockContainer — wraps each block (renders <div> around <div>)

blockContent — extra wrapper div around actual content elements

Problems:

Lists render as <div> instead of semantic <ul>/<ol>/<li>

Three levels of wrapper divs (blockOuter > blockContainer > blockContent) bloat the DOM

blockContent is a separate node type that adds complexity to every command

Toggle between list types requires structural node replacement

Two branches attempt to fix this independently:

editor-refactor-plan (Horacio/Claude) — Unified approach

feat/list-node-type (Yskak) — Dual node type approach

## Approach A: Unified (editor-refactor-plan)

Core idea: Rename existing nodes, flatten DOM, use addNodeView() for dynamic rendering.

### Schema

    Doc
      └─ blockChildren (was blockGroup)
           └─ blockNode+ (was blockContainer)
                ├─ block (content: paragraph | heading | code-block | ...)
                └─ blockChildren? (recursive children)

2 structural node types (renamed from existing)

blockNode uses addNodeView() to render as <li> when inside a list-type blockChildren, or <div> otherwise

blockChildren renders as <ul>, <ol>, or <div> based on its listType attribute

List toggle = setNodeMarkup() on the blockChildren node (attribute change, no structural change)

DOM flattened from 3 wrappers to 1 (blockContent wrapper removed)

### Changes

~400 net lines changed in blocknote core (443 added, 363 removed)

44 files touched (mostly string replacements: blockGroup -> blockChildren, blockContainer -> blockNode)

No new commands or helper functions needed

All existing commands work unchanged (nestBlock, splitBlock, mergeBlocks, etc.)

### Key wins

transformPastedHTML in code-block extension rewrites custom code renderers (CH.Code, Shiki) into <pre> before DOMParser
runs — working and tested

transformPasted in BlockChildren normalizes pasted fragments — working

Semantic HTML output via addNodeView() dynamic rendering

5 passing E2E tests including custom code block paste

## Approach B: Dual Node Types (feat/list-node-type)

Core idea: Add separate ProseMirror node types for list containers and groups.

### Schema

    Doc
      └─ blockGroup (unchanged, for non-list blocks)
           └─ blockContainer+ (unchanged)
                ├─ blockContent
                └─ blockGroup? | listGroup?

      └─ listGroup (NEW — renders <ul>/<ol>/<blockquote>)
           └─ listContainer+ (NEW — renders <li>)
                ├─ blockContent
                └─ listGroup? | blockGroup?

4 structural node types (2 existing + 2 new)

listGroup renders <ul>, <ol>, or <blockquote> based on listType attribute

listContainer renders <li>

List toggle = replace blockGroup node with listGroup (structural transformation) + replace all blockContainer children
with listContainer (recursive)

DOM structure unchanged (still has blockContent wrapper)

### Changes

+1,717 / -359 lines (~1,400 net new lines)

30 files touched

New files:

ListGroup.ts (377 lines) — new node type with input rules, paste plugin (commented out)

ListContainer.ts (59 lines) — new node type

containerHelpers.ts (105 lines, 12 functions) — abstractions for dual-container branching

Heavily modified:

nestBlock.ts (+260 lines) — near-duplicate code paths for list vs block containers

updateGroup.ts (+205 lines) — structural node replacement for list toggle

KeyboardShortcutsExtension.ts (+110 lines) — manual position arithmetic for dual containers

nodeConversions.ts (+114 lines) — list node serialization/deserialization

### Test infrastructure (valuable)

vitest.config.ts — unit test configuration

test-helpers-prosemirror.ts (147 lines) — ProseMirror test document builder

test-helpers.ts (114 lines) — helper utilities

updateGroup.test.ts (143 lines, 3 actual tests) — unit tests for updateGroup

5 empty test files (placeholders for future tests)

JSON fixtures for blockGroup and listGroup test documents

## Detailed Comparison

### 1\. Schema Complexity

![](https://assets.hyper.media/hm/api/image/bafkreiah4q3nspfnarzqee5zlgqhwz3hbmm6zohd744y25fga76gn4m7bq?size=L)

Winner: Unified. Fewer node types = simpler schema, less surface area for bugs.

### 2\. Command Complexity

![](https://assets.hyper.media/hm/api/image/bafkreiemp7eucd4u66sm6kr3etc4cp5muwzfztommybfvkeyh7v6j5jw3y?size=L)

Winner: Unified. The dual approach requires every command that touches block structure to branch on container type. This
creates parallel code paths that must be kept in sync — a maintenance burden that grows with every new command.

### 3\. List Toggle Mechanism

![](https://assets.hyper.media/hm/api/image/bafkreift3gwsxiuo2ogjf352kcspoh52dqbog76mryoygdibhwm33qoari?size=L)

Winner: Unified. Changing an attribute is inherently safer and simpler than replacing nodes.

### 4\. Paste Handling

![](https://assets.hyper.media/hm/api/image/bafkreielbvi2cvzndxfpn7c6vlj6bgxgg57esc3ve2mgrzks5owzclkvxq?size=L)

Winner: Unified. Paste is one of the hardest editor problems. Having working, tested paste handling is a significant
advantage.

### 5\. DOM Output

![](https://assets.hyper.media/hm/api/image/bafkreicph7sedj6r6e7p62tyd3smv4ywaotxjd6fhhnfczigv42ywymgfm?size=L)

Tie on semantics, Unified wins on DOM cleanliness. Both produce valid semantic HTML. The unified approach also flattens
the DOM, reducing wrapper div bloat.

### 6\. Type Safety

![](https://assets.hyper.media/hm/api/image/bafkreibirhwc3tyyzbjvlgvlewz5hsk7ox4va3q6tyxgtuxvtxunuzekum?size=L)

Mixed. The dual approach has stronger schema-level enforcement but trades it for 40+ TypeScript suppressions. The
unified approach relies on runtime behavior in addNodeView() but has clean types.

### 7\. Current State

![](https://assets.hyper.media/hm/api/image/bafkreietvxuougl3ij2v2xzqfzyzvkuvudam3jp3osqzstjyoq32tceca4?size=L)

Winner: Unified. Working code > incomplete code.

## Summary Table

![](https://assets.hyper.media/hm/api/image/bafkreibcsayobb5brpy3arvrylgvlwoiwxgo3o7mo5aw6mnajgvbfrnxcy?size=L)

## What's Valuable in Each

### From Unified (keep)

Flattened DOM (fewer wrapper divs)

Dynamic rendering via addNodeView()

Working paste handling (transformPastedHTML + transformPasted)

Attribute-based list toggle (simple, safe, undoable)

E2E test coverage for paste scenarios

### From Dual (adopt)

Vitest configuration — unit test setup for the editor package

ProseMirror test helpers — test-helpers-prosemirror.ts builds test documents programmatically, invaluable for unit
testing commands

Test fixtures — JSON document fixtures for reproducible tests

updateGroup unit tests — can be adapted to test our updateGroup with the unified schema

Input rules for lists — ListGroup.ts has well-structured InputRule definitions for 1., \-, \> patterns (though our
branch may already handle these via blockChildren)

## Recommendation

Use the unified approach as the base and adopt Yskak's test infrastructure.

Reasons:

3.5x less code for the same result

No command branching = no parallel maintenance burden

Working paste handling (hardest part of editor development)

Simpler mental model: 2 node types, attribute-based list toggle

DOM flattening is a strict improvement (less nesting, same semantics)

The dual approach's only structural advantage — schema-level content enforcement — doesn't justify tripling the codebase
complexity, especially when it comes with 40+ @ts-ignore suppressions and disabled paste handling.

## Consolidation Plan

### Phase 1: Finalize Unified Branch

Complete any remaining edge cases (nested list interactions, keyboard shortcuts)

Ensure all list types (Ordered, Unordered, Blockquote) toggle correctly

Verify paste from all common sources (Google Docs, Notion, web pages, code editors)

Run full E2E suite, fix failures

### Phase 2: Adopt Test Infrastructure

Copy vitest.config.ts from Yskak's branch

Copy test-helpers-prosemirror.ts and test-helpers.ts, adapt for unified schema

Copy JSON fixtures, update node type names (blockContainer -> blockNode, blockGroup -> blockChildren)

Adapt updateGroup.test.ts tests for attribute-based toggle

### Phase 3: Add Unit Tests for Critical Paths

Priority order:

updateGroup — list type toggle (attribute change)

nestBlock — block indentation / list nesting

splitBlock — Enter key behavior in lists

transformPasted (BlockChildren) — paste fragment normalization

transformPastedHTML (code-block) — custom code renderer rewriting

### Phase 4: Communicate and Align

Share this document with Yskak

Acknowledge the valuable test infrastructure contribution

Align on unified approach as the path forward

Coordinate merging to avoid conflicts

Consider pair session to walk through the unified architecture
