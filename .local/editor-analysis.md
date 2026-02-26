# Seed Hypermedia Editor — Comprehensive Architecture Analysis

> **Date:** 2026-02-26
> **Scope:** Full analysis of the rich-text editor powering the Seed Hypermedia desktop app

---

## Executive Summary

The Seed editor is a **React/TypeScript** application built on a three-layer stack:

1. **ProseMirror** — content-editable engine, schema, plugins, state
2. **TipTap v2.0.3** — extension framework wrapping ProseMirror
3. **BlockNote (heavily forked, in-tree)** — block-based document model, manipulation API, and UI

It supports **14 block types**, **8 annotation types**, inline embeds via `hm://` URIs, media uploads to IPFS, XState-driven draft lifecycle, and a bidirectional conversion layer between the editor's inline-content model and the wire-format standoff-annotation model.

> **Note:** Despite the branch name referencing "Svelte," there are **zero `.svelte` files** in the codebase. The entire editor is React + TypeScript.

---

## Table of Contents

1. [File Layout](#1-file-layout)
2. [Technology Stack](#2-technology-stack)
3. [ProseMirror Document Schema](#3-prosemirror-document-schema)
4. [Block Types](#4-block-types)
5. [Annotation / Inline Markup System](#5-annotation--inline-markup-system)
6. [Custom Extensions & Plugins](#6-custom-extensions--plugins)
7. [Editor Initialization & Component Tree](#7-editor-initialization--component-tree)
8. [State Management](#8-state-management)
9. [Data Model & Type System](#9-data-model--type-system)
10. [Serialization / Deserialization (Conversion Layer)](#10-serialization--deserialization-conversion-layer)
11. [Document Change Computation](#11-document-change-computation)
12. [Hypermedia Integration](#12-hypermedia-integration)
13. [Collaboration Support](#13-collaboration-support)
14. [Key Architectural Decisions](#14-key-architectural-decisions)
15. [File Reference Index](#15-file-reference-index)

---

## 1. File Layout

### `@shm/editor` package — `frontend/packages/editor/src/`

| Path | Purpose |
|------|---------|
| `editor-view.tsx` | Top-level `HyperMediaEditorView` component |
| `comment-editor.tsx` | Comment-specific editor wrapper (`useCommentEditor` hook) |
| `schema.ts` | Primary block schema (11 block types + unknown) |
| `full-schema.ts` | Alternative schema with nostr block, without embed block |
| `types.ts` | `HyperMediaEditor` type alias |
| `autocomplete.tsx` | Autocomplete/suggestion plugin for inline embeds |
| `mentions-plugin.tsx` | Inline embed/mention atom node + autocomplete integration |
| `slash-menu-items.tsx` | Slash command menu items |
| `image.tsx`, `video.tsx`, `file.tsx`, `button.tsx`, `math.tsx`, `nostr.tsx`, `web-embed.tsx`, `embed-block.tsx`, `unknown-block.tsx` | Custom block implementations |
| `media-render.tsx`, `media-container.tsx` | Shared media rendering helpers |
| `hm-formatting-toolbar.tsx` | Custom formatting toolbar |
| `hm-link-form.tsx`, `hm-link-preview.tsx`, `hm-toolbar-link-button.tsx` | Hypermedia link UI |
| `hypermedia-link-plugin.tsx` | ProseMirror plugin resolving pasted URLs to `hm://` links |
| `handle-local-media-paste-plugin.ts` | Paste plugin for media files |
| `heading-component-plugin.tsx` | Custom heading block |
| `keyboard-helpers.ts` | Keyboard stack management |
| `block-utils.ts`, `utils.ts` | Editor utility functions |
| `tiptap-extension-code-block/` | Custom code block extension (lowlight syntax highlighting) |
| `tiptap-extension-link/` | Custom link mark extension |

### BlockNote Core — `frontend/packages/editor/src/blocknote/core/`

| Path | Purpose |
|------|---------|
| `BlockNoteEditor.ts` | Central `BlockNoteEditor` class (~914 lines) |
| `BlockNoteExtensions.ts` | Extension registry assembling all TipTap extensions |
| `api/blockManipulation/` | Block CRUD commands (insert, remove, replace, update, split, nest, merge, updateGroup) |
| `api/nodeConversions/` | ProseMirror node ↔ Block object conversion |
| `api/formatConversions/` | HTML and Markdown serialization/deserialization |
| `extensions/Blocks/nodes/` | `BlockNode`, `BlockChildren`, `Doc` schema definitions |
| `extensions/Blocks/api/` | Block types, inline content types, default blocks, serialization |
| `extensions/Blocks/helpers/` | `findBlock`, `getBlockInfoFromPos`, `getGroupInfoFromPos` |
| `extensions/BlockManipulation/` | Block manipulation extension |
| `extensions/KeyboardShortcuts/` | Extensive keyboard handling |
| `extensions/UniqueID/` | Unique block ID assignment |
| `extensions/Placeholder/` | Placeholder text |
| `extensions/TrailingNode/` | Ensures trailing empty block |
| `extensions/FormattingToolbar/` | Formatting toolbar plugin |
| `extensions/HyperlinkToolbar/` | Hyperlink toolbar plugin |
| `extensions/SlashMenu/` | Slash command menu plugin |
| `extensions/SideMenu/` | Block side menu plugin (drag handle, add block) |
| `extensions/LinkMenu/` | `[[` link menu plugin |
| `extensions/Markdown/` | Markdown paste handling |
| `extensions/DragMedia/` | Drag extension |
| `extensions/DraggableBlocks/` | Draggable blocks + multiple node selection |
| `shared/plugins/suggestion/` | Suggestion/autocomplete plugin |

### BlockNote React — `frontend/packages/editor/src/blocknote/react/`

| Path | Purpose |
|------|---------|
| `BlockNoteView.tsx` | React wrapper around TipTap `EditorContent` |
| `ReactBlockSpec.tsx` | `createReactBlockSpec()` for React-rendered blocks |
| `hooks/useBlockNote.ts` | Creates `BlockNoteEditor` instances |
| `hooks/useEditorContentChange.ts` | React hook for content change subscription |
| `hooks/useEditorSelectionChange.ts` | React hook for selection change subscription |
| UI component directories | FormattingToolbar, HyperlinkToolbar, SideMenu, SlashMenu, LinkMenu |

### Desktop App Integration — `frontend/apps/desktop/src/`

| Path | Purpose |
|------|---------|
| `components/editor.tsx` | `HyperMediaEditorView` wrapper for desktop |
| `models/documents.ts` | `useDraftEditor()` hook (editor initialization + XState integration) |
| `models/editor-utils.ts` | `setGroupTypes()` utility |
| `models/draft-machine.ts` | XState state machine for draft lifecycle |
| `pages/draft.tsx` | `DraftPage` component (main editing page) |

### Shared Conversion Layer — `frontend/packages/shared/src/`

| Path | Purpose |
|------|---------|
| `editor-types.ts` | TypeScript types for editor blocks (`EditorBlock`, `EditorText`, etc.) |
| `hm-types.ts` | Zod-validated HM document/block/annotation types |
| `client/editorblock-to-hmblock.ts` | Editor → HM block conversion (for saving) |
| `client/hmblock-to-editorblock.ts` | HM → Editor block conversion (for loading) |
| `client/unicode.ts` | Unicode code-point utilities, `AnnotationSet` class |
| `utils/document-changes.ts` | Compute `DocumentChange` operations for publishing |
| `document-utils.ts` | `prepareHMDocument()` — sanitize + Zod parse server documents |
| `html-to-blocks.ts` | HTML → `HMBlockNode[]` via Cheerio |
| `document-to-text.ts` | Recursive document → plain text conversion |

### Protobuf Definitions — `proto/documents/v3alpha/`

| Path | Purpose |
|------|---------|
| `documents.proto` | Wire-format definitions: `Document`, `BlockNode`, `Block`, `Annotation`, `DocumentChange` |

---

## 2. Technology Stack

| Layer | Technology | Version | Role |
|-------|-----------|---------|------|
| Engine | ProseMirror | (via TipTap) | Content-editable, schema, plugins, state, view |
| Framework | TipTap | v2.0.3 | Extension system, React bindings, standard marks |
| Block Model | BlockNote (forked) | In-tree | Block-based document model, manipulation API, UI |
| UI Framework | React | — | Component rendering |
| UI Theming | Mantine | v6.0.22 | Theme provider for editor UI |
| Collaboration | Yjs / y-prosemirror | v13.6.4 / v1.2.1 | Structural support (not currently wired) |
| Math | KaTeX | — | LaTeX rendering |
| Code Highlighting | lowlight / highlight.js | — | Syntax highlighting |
| Format Conversion | rehype / remark / unified | — | Markdown ↔ HTML ↔ Blocks |
| State Machine | XState | — | Draft lifecycle management |
| Data Fetching | React Query | — | Server data caching |
| Types | Zod | — | Runtime schema validation for HM types |
| Wire Format | Protobuf (protoc-gen-es) | v1.10.0 | Server communication |

### Key Dependencies (from `package.json`)

```
@tiptap/core, @tiptap/react, @tiptap/pm              (v2.0.3)
@tiptap/extension-{bold,italic,strike,underline,code,
  hard-break,history,dropcursor,gapcursor,
  collaboration,collaboration-cursor}                  (v2.0.3)
yjs (v13.6.4), y-prosemirror (v1.2.1), y-protocols
@mantine/core (v6.0.22)
katex, mermaid, lowlight, highlight.js
rehype, remark, unified-latex
prosemirror-state (v1.4.4)
```

---

## 3. ProseMirror Document Schema

The schema follows a nested hierarchy defined in the BlockNote core:

```
doc
  └─ blockChildren (listType='Group')
       └─ blockNode (id=<uuid>)
            ├─ blockContent (paragraph | heading | image | code-block | ...)
            │    └─ inline* (text, inline-embed, etc.)
            └─ blockChildren? (listType='Group'|'Ordered'|'Unordered'|'Blockquote')
                 └─ blockNode (id=...)
                      └─ ...
```

### Schema Nodes

- **`Doc`** — topNode, content: `blockChildren`
- **`BlockNode`** — main block wrapper, content: `block blockChildren?`, group: `blockNodeChild block`. Has `id` attribute (via `UniqueID` extension)
- **`BlockChildren`** — children container, content: `blockNodeChild+`. Attributes: `listType` (`Group` | `Ordered` | `Unordered` | `Blockquote`), `listLevel` (string, default `"1"`)
- **Block content nodes** — each block type (paragraph, heading, code-block, image, etc.) lives in the `block` group with content `inline*`

### List Representation

Lists are **not** separate block types. Instead, the `blockChildren` wrapper's `listType` attribute determines rendering:

| `listType` | Rendering |
|-----------|-----------|
| `Group` | Default (no list markers) |
| `Unordered` | Bullet list (`<ul>`) |
| `Ordered` | Numbered list (`<ol>`) |
| `Blockquote` | Block quote (`<blockquote>`) |

Input rules in `BlockChildren` convert typed prefixes (`- `, `1. `, `> `) into the appropriate `listType`.

---

## 4. Block Types

### Schema Registration (`schema.ts`)

```typescript
export const hmBlockSchema: BlockSchema = {
  paragraph:    defaultBlockSchema.paragraph,
  heading:      { propSchema: {...defaultProps, level: {default: '1'}}, node: HMHeadingBlockContent },
  'code-block': { propSchema: {...defaultProps, language: {default: ''}}, node: CodeBlockLowlight },
  file:         FileBlock,
  image:        ImageBlock,
  video:        VideoBlock,
  button:       ButtonBlock,
  math:         MathBlock('math'),
  'web-embed':  WebEmbed,
  embed:        EmbedBlock,
  unknown:      UnknownBlock,
}
```

### Block Type Reference

| Editor Type | HM Type | Source File | Key Props | Has Inline Content |
|-------------|---------|-------------|-----------|-------------------|
| `paragraph` | `Paragraph` | Built-in (`ParagraphBlockContent`) | `textAlignment`, `childrenType` | Yes |
| `heading` | `Heading` | `heading-component-plugin.tsx` | `level` (1–3) | Yes |
| `code-block` | `Code` | `tiptap-extension-code-block/` | `language` | Yes (lowlight syntax) |
| `image` | `Image` | `image.tsx` | `url`, `displaySrc`, `fileBinary`, `mediaRef`, `alt`, `name`, `width` | Yes (caption) |
| `video` | `Video` | `video.tsx` | `url`, `displaySrc`, `fileBinary`, `mediaRef`, `name`, `width` | Yes |
| `file` | `File` | `file.tsx` | `url`, `displaySrc`, `fileBinary`, `mediaRef`, `name`, `size` | Yes |
| `button` | `Button` | `button.tsx` | `url`, `name`, `alignment` | Yes |
| `embed` | `Embed` | `embed-block.tsx` | `url`, `view` (`Content` / `Card`) | Yes |
| `web-embed` | `WebEmbed` | `web-embed.tsx` | `url` | Yes |
| `math` | `Math` | `math.tsx` | (text is LaTeX) | Yes |
| `nostr` | `Nostr` | `nostr.tsx` | `url` (nostr:// URI) | Yes |
| `unknown` | (pass-through) | `unknown-block.tsx` | `originalType`, `originalData` | Yes |
| — | `Query` | (no editor block) | `style`, `columnCount`, `query`, `banner` | — |
| — | `Group` | (structural only) | — | — |
| — | `Link` | (structural only) | `link`, `text` | — |

### Shared Default Props

All blocks inherit `defaultProps`:

```typescript
{
  textAlignment: 'left' | 'center' | 'right' | 'justify',
  diff: 'deleted' | 'added' | 'updated' | null,
  childrenType: 'Group' | 'Unordered' | 'Ordered' | 'Blockquote',
  listLevel: string (default '1'),
}
```

### Block Implementation Pattern

Custom blocks use `createReactBlockSpec()` from BlockNote React:

```typescript
export const ImageBlock = createReactBlockSpec({
  type: 'image',
  propSchema: { ...defaultProps, url: {default: ''}, width: {default: ''}, ... },
  containsInlineContent: true,
  render: ({block, editor}) => <MediaRender ... />,
  parseHTML: [{ tag: 'img[src]', getAttrs: ... }],
})
```

This creates a TipTap node extension using `ReactNodeViewRenderer`, so each block renders as a React component inside ProseMirror.

---

## 5. Annotation / Inline Markup System

The editor and HM model use **two different representations** for inline markup:

### Editor Representation (Inline Content Tree)

```typescript
type HMInlineContent = EditorText | EditorInlineEmbed | EditorLink

interface EditorText {
  type: 'text'
  text: string
  styles: EditorInlineStyles  // { bold?, italic?, underline?, strike?, code?, math?, range? }
}
interface EditorLink {
  type: 'link'
  href: string
  content: HMInlineContent[]
}
interface EditorInlineEmbed {
  type: 'inline-embed'
  link: string  // hm:// URI
  styles: {}
}
```

### HM Wire Representation (Standoff Annotations)

```typescript
// Annotation uses columnar span encoding (SoA format)
interface Annotation {
  type: string      // 'Bold', 'Italic', 'Link', 'Embed', etc.
  link?: string     // For Link/Embed annotations
  attributes?: {}
  starts: number[]  // Code-point offsets (sorted, possibly disjoint)
  ends: number[]    // Code-point offsets (sorted, same length as starts)
}
```

### Annotation Types

| HM Type | Editor Style/Node | Description |
|---------|------------------|-------------|
| `Bold` | `styles.bold: true` | Bold text |
| `Italic` | `styles.italic: true` | Italic text |
| `Underline` | `styles.underline: true` | Underlined text |
| `Strike` | `styles.strike: true` | Strikethrough text |
| `Code` | `styles.code: true` | Inline code |
| `Range` | `styles.range: true` | Highlight / comment range |
| `Link` | `EditorLink` node | Hyperlink (with `link` field) |
| `Embed` | `EditorInlineEmbed` node | Inline embed (with `link` field, `hm://` URI) |

### Conversion Example

**Editor format:**
```json
[
  {"type": "text", "text": "Hello ", "styles": {"bold": true}},
  {"type": "link", "href": "hm://abc", "content": [
    {"type": "text", "text": "world", "styles": {"bold": true, "italic": true}}
  ]},
  {"type": "text", "text": "!", "styles": {}}
]
```

**HM wire format:**
```json
{
  "text": "Hello world!",
  "annotations": [
    {"type": "Bold", "starts": [0], "ends": [11]},
    {"type": "Italic", "starts": [6], "ends": [11]},
    {"type": "Link", "link": "hm://abc", "starts": [6], "ends": [11]}
  ]
}
```

### Unicode Handling

Offsets are in **Unicode code points**, not UTF-16 code units. The `unicode.ts` module provides:

- `codePointLength(text)` — counts code points correctly (handles surrogate pairs)
- `isSurrogate(s, i)` — detects surrogate pair starts
- `AnnotationSet` — accumulates spans during conversion with automatic merging of adjacent spans

---

## 6. Custom Extensions & Plugins

### TipTap Extensions (assembled in `BlockNoteExtensions.ts`)

| Extension | Source | Purpose |
|-----------|--------|---------|
| **Standard marks** | `@tiptap/extension-*` | Bold, Italic, Strike, Underline, Code, HardBreak |
| **Standard nodes** | `@tiptap/extension-*` | Text, Gapcursor, Dropcursor, History |
| `Doc`, `BlockNode`, `BlockChildren` | `extensions/Blocks/` | Document schema structure |
| `UniqueID` | `extensions/UniqueID/` | Assigns unique IDs to block nodes |
| `Placeholder` | `extensions/Placeholder/` | Shows placeholder text in empty blocks |
| `TrailingNode` | `extensions/TrailingNode/` | Ensures there's always a trailing empty block |
| `BlockManipulationExtension` | `extensions/BlockManipulation/` | Block split/merge commands |
| `KeyboardShortcutsExtension` | `extensions/KeyboardShortcuts/` | Extensive keyboard handling (backspace, enter, tab, etc.) |
| `CustomBlockSerializerExtension` | `extensions/Blocks/api/serialization.ts` | Clipboard serialization |
| `Link` (custom) | `tiptap-extension-link/` | Custom link mark with HM-specific behavior |
| `MarkdownExtension` | `extensions/Markdown/` | Markdown paste handling |
| `InlineEmbedNode` | `mentions-plugin.tsx` | `@mention` inline embed atom node |
| `LocalMediaPastePlugin` | `handle-local-media-paste-plugin.ts` | Media file paste handling |
| `HypermediaDocLinkPlugin` | `hypermedia-link-plugin.tsx` | Async URL → `hm://` resolution |
| `debugPlugin` | `prosemirror-debugger.ts` | ProseMirror debug plugin |

### Custom ProseMirror Plugins (within BlockNode)

| Plugin | Purpose |
|--------|---------|
| `SelectionPlugin` | Decoration-based selection highlighting |
| `ClickSelectionPlugin` | Shift+click range selection |
| `PastePlugin` | Paste handling for image blocks |
| `headingBoxPlugin` | Decorates the section around the nearest heading |
| Em-dash plugin | Auto-replaces `--` → `---` |

### UI Plugin System

Each UI element has a corresponding ProseMirror plugin for state/position tracking:

| Plugin | Trigger | Purpose |
|--------|---------|---------|
| `SideMenuProsemirrorPlugin` | Mouse hover on blocks | Block drag handle, add-block button |
| `FormattingToolbarProsemirrorPlugin` | Text selection | Bold/italic/etc. toolbar |
| `SlashMenuProsemirrorPlugin` | Typing `/` | Slash command menu |
| `HyperlinkToolbarProsemirrorPlugin` | Clicking a link | Link edit/preview toolbar |
| `LinkMenuProsemirrorPlugin` | Typing `[[` | Document/link search menu |

---

## 7. Editor Initialization & Component Tree

### Initialization Flow

```
DraftPage (pages/draft.tsx)
  └─ useDraftEditor() (models/documents.ts)
       ├─ useBlockNote<typeof hmBlockSchema>(options)
       │    └─ new BlockNoteEditor(options)
       │         ├─ getBlockNoteExtensions() → TipTap extensions array
       │         ├─ blockToNode() for each initial block → ProseMirror nodes
       │         └─ new Editor({...tiptapOptions}) → TipTap core editor
       │
       └─ useMachine(draftMachine) → XState actor
            └─ On fetch.success: editor.replaceBlocks() + setGroupTypes()

HyperMediaEditorView (components/editor.tsx)
  └─ BlockNoteView (MantineProvider + EditorContent)
       ├─ FormattingToolbarPositioner
       ├─ HyperlinkToolbarPositioner
       ├─ SlashMenuPositioner
       ├─ SideMenuPositioner
       └─ LinkMenuPositioner
```

### `useDraftEditor()` Options

```typescript
useBlockNote<typeof hmBlockSchema>({
  blockSchema: hmBlockSchema,
  onEditorContentChange: (editor) => { /* sends 'change' to XState machine */ },
  linkExtensionOptions: { grpcClient, gwUrl, checkWebUrl },
  importWebFile: (url, name) => ...,
  onMentionsQuery: (query) => ...,
  getSlashMenuItems: () => [...],
  _tiptapOptions: { extensions: [createHypermediaDocLinkPlugin(...)] },
})
```

### Comment Editor

`useCommentEditor()` in `comment-editor.tsx` follows the same pattern but with:
- A `submitShortcutExtension` for Cmd/Ctrl+Enter
- Different slash menu items
- Mobile support configuration

---

## 8. State Management

### Layer Architecture

```
┌──────────────────────────────────────────────────┐
│  Layer 5: React Query                            │
│  Fetches/caches documents, drafts, resources     │
├──────────────────────────────────────────────────┤
│  Layer 4: XState Draft Machine                   │
│  States: loading → idle ↔ saving ↔ error         │
│  Events: fetch.success, change, reset.content    │
├──────────────────────────────────────────────────┤
│  Layer 3: React Hooks                            │
│  useBlockNote(), useEditorContentChange(),       │
│  useEditorSelectionChange()                      │
├──────────────────────────────────────────────────┤
│  Layer 2: BlockNoteEditor                        │
│  topLevelBlocks getter, blockCache WeakMap,      │
│  callback-based change notifications             │
├──────────────────────────────────────────────────┤
│  Layer 1: ProseMirror EditorState                │
│  The actual document content (source of truth)   │
└──────────────────────────────────────────────────┘
```

### Draft Lifecycle (XState)

The `draftMachine` manages:
- **Loading:** Fetching draft data from the server
- **Idle:** Waiting for user edits
- **Saving:** Debounced auto-save on content changes
- **Error:** Save failure handling

Content changes flow:
1. User edits → ProseMirror transaction
2. `onEditorContentChange` callback fires
3. Callback sends `change` event to XState machine
4. Machine triggers `writeDraft` actor
5. `writeDraft` serializes `editor.topLevelBlocks` → saves via `client.drafts.write.mutate()`

---

## 9. Data Model & Type System

### Protobuf Wire Format (`documents.proto`)

```protobuf
message Document {
  string account = 1;
  string path = 2;
  google.protobuf.Struct metadata = 3;
  repeated string authors = 5;
  repeated BlockNode content = 6;
  map<string, BlockNode> detached_blocks = 14;
  google.protobuf.Timestamp create_time = 7;
  google.protobuf.Timestamp update_time = 8;
  string genesis = 9;
  string version = 10;
  ResourceVisibility visibility = 15;
}

message BlockNode {
  Block block = 1;
  repeated BlockNode children = 2;
}

message Block {
  string id = 1;
  string type = 2;
  string text = 3;
  string link = 7;
  google.protobuf.Struct attributes = 4;
  repeated Annotation annotations = 5;
  string revision = 6;
}

message Annotation {
  string type = 1;
  string link = 5;
  google.protobuf.Struct attributes = 2;
  repeated int32 starts = 3;  // Code-point offsets (SoA format)
  repeated int32 ends = 4;
}

message DocumentChange {
  oneof op {
    SetMetadata set_metadata = 1;   // Deprecated
    MoveBlock move_block = 2;
    Block replace_block = 3;
    string delete_block = 4;
    SetAttribute set_attribute = 5;
  }
}
```

### Frontend Validated Types (`hm-types.ts`)

The frontend maintains a parallel type system validated with **Zod schemas**:

#### HMBlockSchema (14 known types + unknown)

```typescript
HMBlockKnownSchema = z.discriminatedUnion('type', [
  HMBlockParagraphSchema,    // 'Paragraph'
  HMBlockHeadingSchema,      // 'Heading'
  HMBlockCodeSchema,         // 'Code'
  HMBlockMathSchema,         // 'Math'
  HMBlockImageSchema,        // 'Image'
  HMBlockVideoSchema,        // 'Video'
  HMBlockFileSchema,         // 'File'
  HMBlockButtonSchema,       // 'Button'
  HMBlockEmbedSchema,        // 'Embed'
  HMBlockWebEmbedSchema,     // 'WebEmbed'
  HMBlockNostrSchema,        // 'Nostr'
  HMBlockQuerySchema,        // 'Query'
  HMBlockGroupSchema,        // 'Group'
  HMBlockLinkSchema,         // 'Link'
])
```

#### HMAnnotationSchema

```typescript
HMAnnotationSchema = z.discriminatedUnion('type', [
  BoldAnnotationSchema,           // 'Bold'
  ItalicAnnotationSchema,         // 'Italic'
  UnderlineAnnotationSchema,      // 'Underline'
  StrikeAnnotationSchema,         // 'Strike'
  CodeAnnotationSchema,           // 'Code'
  LinkAnnotationSchema,           // 'Link'    (has link field)
  InlineEmbedAnnotationSchema,    // 'Embed'   (has link field, hm:// URI)
  HighlightAnnotationSchema,      // 'Range'
])
```

#### HMDocumentMetadata

```typescript
HMDocumentMetadataSchema = z.object({
  name, summary, icon, cover, siteUrl,
  layout: 'Seed/Experimental/Newspaper' | '',
  displayPublishTime, seedExperimentalLogo, seedExperimentalHomeOrder,
  showOutline, showActivity,
  contentWidth: 'S' | 'M' | 'L',
  theme: { headerLayout: ... },
})
```

### Editor Type System (`editor-types.ts`)

```typescript
type EditorBlock =
  | EditorParagraphBlock     // type: 'paragraph'
  | EditorHeadingBlock       // type: 'heading'
  | EditorCodeBlock          // type: 'code-block'
  | EditorImageBlock         // type: 'image'
  | EditorVideoBlock         // type: 'video'
  | EditorFileBlock          // type: 'file'
  | EditorButtonBlock        // type: 'button'
  | EditorEmbedBlock         // type: 'embed'
  | EditorWebEmbedBlock      // type: 'web-embed'
  | EditorMathBlock          // type: 'math'
  | EditorNostrBlock         // type: 'nostr'
  | EditorQueryBlock         // type: 'query'
  | EditorUnknownBlock       // type: 'unknown'

// Each block: { id, type, content: HMInlineContent[], props: EditorBlockProps, children: EditorBlock[] }
```

---

## 10. Serialization / Deserialization (Conversion Layer)

### Data Flow Overview

```
┌─────────────────────────┐
│  TipTap/BlockNote Editor│
│  (EditorBlock[] tree)   │
└──────────┬──────────────┘
           │ editorBlockToHMBlock()
           │ flattens inline tree → text + standoff annotations
           ▼
┌─────────────────────────┐
│  HMBlock / HMBlockNode  │
│  (frontend Zod types)   │
└──────────┬──────────────┘
           │ compareBlocksWithMap()
           │ diffs against previous → DocumentChange[]
           ▼
┌─────────────────────────┐
│  DocumentChange protobuf│
│  (moveBlock, replaceBlock, deleteBlock, setAttribute)
└──────────┬──────────────┘
           │ CreateDocumentChange RPC
           ▼
┌─────────────────────────┐
│  Backend (CRDT/Storage) │
└──────────┬──────────────┘
           │ GetDocument RPC
           ▼
┌─────────────────────────┐
│  Document protobuf      │
└──────────┬──────────────┘
           │ prepareHMDocument()
           │ sanitize + Zod parse
           ▼
┌─────────────────────────┐
│  HMDocument             │
│  (validated frontend)   │
└──────────┬──────────────┘
           │ hmBlocksToEditorContent()
           │ expands text + annotations → inline content tree
           ▼
┌─────────────────────────┐
│  EditorBlock[]          │
│  (loaded into TipTap)   │
└──────────────────────────┘
```

### Editor → HM Conversion (`editorblock-to-hmblock.ts`)

**Algorithm:**

1. Flatten the editor's tree of inline content (links wrapping text) into a flat leaf list
2. Walk leaves, accumulating text into a single `text` string
3. Build an `AnnotationSet` mapping each style boolean to standoff spans (using `codePointLength`)
4. Inline embeds become `\uFFFC` (Object Replacement Character) with an `Embed` annotation
5. Links become `Link` annotations with their `link` field
6. Extract block-type-specific attributes from `props` into `attributes` (e.g., `language` for Code)
7. Media blocks use `link` for resource URL (typically `ipfs://...`)
8. Validate through `HMBlockSchema.safeParse()`

**Type Name Mapping:**

| Editor Type | HM Type |
|-------------|---------|
| `paragraph` | `Paragraph` |
| `heading` | `Heading` |
| `code-block` | `Code` |
| `math` | `Math` |
| `image` | `Image` |
| `video` | `Video` |
| `file` | `File` |
| `button` | `Button` |
| `embed` | `Embed` |
| `web-embed` | `WebEmbed` |
| `query` | `Query` |

### HM → Editor Conversion (`hmblock-to-editorblock.ts`)

**Algorithm:**

1. Map HM type to editor type (reverse of above, plus `Nostr` → `nostr`, unknown → `unknown`)
2. Walk through the block's text character by character (handling surrogate pairs)
3. At each code-point position, check which annotations apply using **binary search** on spans
4. When annotations change at a position, finish the current `EditorText` leaf and start a new one
5. Link annotations spawn `EditorLink` wrapper nodes
6. Embed annotations spawn `EditorInlineEmbed` nodes
7. Children are recursively converted, preserving `childrenType`
8. Unknown block types preserve `originalType` and `originalData` (JSON-serialized) in editor props

### Server Document Preparation (`document-utils.ts`)

```typescript
function prepareHMDocument(apiDoc: Document): HMDocument {
  // 1. Convert protobuf to JSON
  const json = apiDoc.toJson({ emitDefaultValues: true })
  // 2. Sanitize: validate required fields, drop invalid blocks
  sanitizeDocumentStructure(json)
  // 3. Zod parse for type safety
  return HMDocumentSchema.parse(json)
}
```

---

## 11. Document Change Computation

### `compareBlocksWithMap()` (`document-changes.ts`)

This is the core diff engine generating `DocumentChange` protobufs:

1. **`createBlocksMap(blockNodes, parentId)`** — Flattens the existing server document into a `BlocksMap` recording each block's `parent`, `left` sibling, and block data
2. **`compareBlocksWithMap(blocksMap, editorBlocks, parentId)`** — For each editor block:
   - Convert to HM format via `editorBlockToHMBlock()`
   - If new or `listLevel` changed → emit `moveBlock` + `replaceBlock`
   - If moved (different parent/left sibling) → emit `moveBlock`
   - If content changed (`isBlocksEqual` comparison) → emit `replaceBlock`
   - Recursively process children
3. **`extractDeletes(blocksMap, touchedBlocks)`** — Any block IDs in the map not touched by the editor are emitted as `deleteBlock`

### `isBlocksEqual()` Comparison

Compares two HM blocks field by field:
- `id`, `text`, `link`, `type`
- `annotations` (deep equality via lodash)
- `attributes` (comparing a fixed list of known attribute names)

### `getDocAttributeChanges()`

Generates `SetAttribute` changes for document metadata: name, summary, icon, cover, siteUrl, layout, displayPublishTime, etc.

---

## 12. Hypermedia Integration

### `hm://` URI System

The editor deeply integrates with Seed's `hm://` URI scheme:
- **Block-level embeds** (`embed` block type) reference other HM documents via `hm://` in the `link` field
- **Inline embeds** (`@mention`) insert atom nodes with `hm://` URIs that resolve to document titles
- **Links** can be either standard HTTP URLs or `hm://` URIs pointing to HM documents

### Hypermedia Link Plugin (`hypermedia-link-plugin.tsx`)

A ProseMirror plugin that:
1. Watches for newly created links in transactions
2. Asynchronously resolves web URLs to `hm://` URIs via `resolveHypermediaUrl()`
3. Replaces link `href` attributes with resolved `hm://` URIs

### Inline Mentions (`mentions-plugin.tsx`)

The `@` trigger activates the autocomplete plugin:
1. Shows a popup with document/contact search results
2. Inserts `inline-embed` atom nodes with `hm://` URIs
3. Renders via `MentionToken` which resolves to document titles or contact names

### Media Storage

Media blocks support multiple storage modes:
- **IPFS URLs** (`ipfs://...`) — for published content
- **Draft media** (`mediaRef` with `{draftId, mediaId, name, mime, size}`) — stored in IndexedDB during editing
- **Display source** (`displaySrc`) — temporary blob/data URLs for preview
- **File binary** (`fileBinary`) — raw bytes for web platform

### Additional Conversion Utilities

| Utility | File | Purpose |
|---------|------|---------|
| HTML → Blocks | `html-to-blocks.ts` | Converts pasted HTML to `HMBlockNode[]` via Cheerio |
| Blocks → Markdown | `apps/desktop/src/utils/blocks-to-markdown.ts` | Exports editor content as Markdown + YAML front matter |
| Document → Text | `document-to-text.ts` | Recursive plain-text export (resolves inline embeds via gRPC) |

---

## 13. Collaboration Support

### Structural Support (Not Currently Active)

The codebase has **structural** support for Yjs-based real-time collaboration:

- `@tiptap/extension-collaboration` and `@tiptap/extension-collaboration-cursor` are in `package.json`
- `yjs`, `y-prosemirror`, `y-protocols` are installed
- `BlockNoteEditorOptions.collaboration` accepts `{ fragment: Y.XmlFragment, user, provider }`
- `BlockNoteEditor.updateCollaborationUserInfo()` method exists

However, `getBlockNoteExtensions()` does **not** currently wire the collaboration extensions into the extension array. The option is accepted but not activated.

### Change Tracking (Display Only)

The `defaultProps.diff` property (`deleted` | `added` | `updated` | `null`) supports **visual diff display** between document versions. This is display-only — not real-time collaborative change tracking. Diff values are applied as block props and styled via CSS.

---

## 14. Key Architectural Decisions

### 1. Dual Representation Model

The most significant architectural decision is maintaining two distinct content representations:

- **Editor model:** Tree of inline content nodes (`EditorText`, `EditorLink`, `EditorInlineEmbed`)
- **Wire model:** Flat text + standoff annotations (columnar `starts[]`/`ends[]`)

This allows the editor to use a natural tree-based editing model while the persistence layer uses a more compact, CRDT-friendly format.

### 2. Forked BlockNote (In-Tree)

Rather than depending on the BlockNote npm package, the entire BlockNote layer is forked into the source tree. This allows deep customization (custom schema nodes, block types, keyboard handling) without upstream dependency constraints.

### 3. Lists as Block Attributes

Lists are not separate block types but rather attributes on the `blockChildren` container node (`listType`). This simplifies the block type system and makes conversion between list types trivial (just change an attribute).

### 4. Open-Ended Attributes via `google.protobuf.Struct`

Block attributes use an open-ended `Struct` field rather than strongly typed protobuf fields. This allows adding new block-type-specific attributes without changing the protobuf schema, at the cost of losing compile-time type safety on the wire format (compensated by Zod validation on the frontend).

### 5. Code-Point-Aware Unicode Handling

Annotation offsets use Unicode **code points** (not UTF-16 code units). The conversion layer includes dedicated utilities for surrogate pair detection and code-point counting, ensuring correct behavior with emoji and non-BMP characters.

### 6. Granular Document Changes

Rather than replacing entire documents, the system computes granular `DocumentChange` operations (move, replace, delete individual blocks). This enables efficient CRDT-based synchronization.

---

## 15. File Reference Index

### Core Editor Files

| File | Lines | Key Exports |
|------|-------|-------------|
| `packages/editor/src/schema.ts` | 47 | `hmBlockSchema`, `HMBlockSchema` |
| `packages/editor/src/editor-view.tsx` | — | `HyperMediaEditorView` |
| `packages/editor/src/blocknote/core/BlockNoteEditor.ts` | ~914 | `BlockNoteEditor`, `BlockNoteEditorOptions` |
| `packages/editor/src/blocknote/core/BlockNoteExtensions.ts` | ~150 | `getBlockNoteExtensions()` |
| `packages/editor/src/blocknote/react/BlockNoteView.tsx` | — | `BlockNoteView` |
| `packages/editor/src/blocknote/react/ReactBlockSpec.tsx` | — | `createReactBlockSpec()` |
| `packages/editor/src/blocknote/react/hooks/useBlockNote.ts` | — | `useBlockNote()` |

### Block Type Implementations

| File | Block Type |
|------|-----------|
| `packages/editor/src/heading-component-plugin.tsx` | heading |
| `packages/editor/src/tiptap-extension-code-block/` | code-block |
| `packages/editor/src/image.tsx` | image |
| `packages/editor/src/video.tsx` | video |
| `packages/editor/src/file.tsx` | file |
| `packages/editor/src/button.tsx` | button |
| `packages/editor/src/embed-block.tsx` | embed |
| `packages/editor/src/web-embed.tsx` | web-embed |
| `packages/editor/src/math.tsx` | math |
| `packages/editor/src/nostr.tsx` | nostr |
| `packages/editor/src/unknown-block.tsx` | unknown |

### Conversion & Data Model

| File | Key Exports |
|------|-------------|
| `packages/shared/src/editor-types.ts` | `EditorBlock`, `HMInlineContent`, `EditorInlineStyles` |
| `packages/shared/src/hm-types.ts` | `HMBlockSchema`, `HMAnnotationSchema`, `HMDocumentSchema` |
| `packages/shared/src/client/editorblock-to-hmblock.ts` | `editorBlockToHMBlock()` |
| `packages/shared/src/client/hmblock-to-editorblock.ts` | `hmBlockToEditorBlock()`, `hmBlocksToEditorContent()` |
| `packages/shared/src/client/unicode.ts` | `codePointLength()`, `AnnotationSet` |
| `packages/shared/src/utils/document-changes.ts` | `compareBlocksWithMap()`, `getDocAttributeChanges()` |
| `packages/shared/src/document-utils.ts` | `prepareHMDocument()` |
| `proto/documents/v3alpha/documents.proto` | Protobuf definitions |

### Desktop App Integration

| File | Key Exports |
|------|-------------|
| `apps/desktop/src/pages/draft.tsx` | `DraftPage` |
| `apps/desktop/src/models/documents.ts` | `useDraftEditor()` |
| `apps/desktop/src/models/draft-machine.ts` | `draftMachine` |
| `apps/desktop/src/models/editor-utils.ts` | `setGroupTypes()` |
| `apps/desktop/src/components/editor.tsx` | `HyperMediaEditorView` wrapper |
