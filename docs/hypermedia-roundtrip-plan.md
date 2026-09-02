# Hypermedia round-trip: edit `hypermedia/` in the Seed app, keep git as the source of truth

Status: Phases 1 and 2 done (branch `feat/onyx-roundtrip`, based on `feat/onyx`). Started 2026-09-02. Phase 3 (local dev loop) next.

## The problem

`hypermedia/*.md` and `hypermedia/*.schema.json` are the source of truth for the Onyx type library and its docs, and
`frontend/apps/cli/src/sync-onyx.ts` publishes them to the onyx site. Editing markdown and JSON by hand is not how we
want to author this content. We want to edit it in the real Seed app, and have the result land back in the folder as
markdown and JSON, so git stays the source of truth and the network stays a publication of it.

## The design

Nothing in the app changes. A script owns the folder and talks to the daemon the desktop dev app already runs.

1. **Lossless converters.** `@seed-hypermedia/client`'s `blocksToMarkdown` / `parseMarkdown` become a lossless pair:
   every block type, annotation, attribute and every metadata key exports and re-imports to an identical document. This
   is a general capability (lossless export/import of any HM site), not an onyx feature.
2. **Pull.** For each path in a space, fetch the latest version and write the markdown file. For a document whose
   metadata carries `schemaDefinition`, decode the schema blob and write the co-located `*.schema.json` with a fixed key
   order so unchanged schemas produce no diff.
3. **Push as an update.** The push fetches the current document, diffs blocks by id, and publishes a change against the
   existing genesis. Today every run mints a fresh genesis and orphans anything edited in the app.
4. **Local dev loop.** One command finds or creates an unencrypted dev key in a gitignored directory, registers it in
   the local daemon (`RegisterKey` / `ImportKey` over gRPC), pushes the folder as that account, opens the site in the
   desktop app, and polls the feed (`ListEvents`, `order: 'observed'`, filtered to the dev account) to write files back
   as documents are published locally. Publishing to the local daemon is, in effect, "save".
5. **Publishing to hyper.media** stays a separate, git-driven push signed with the onyx key.

## Work breakdown

### Phase 1: lossless round-trip (client package)

Deliverable: a test that builds a kitchen-sink document covering every block type, every annotation type, every block
attribute and every metadata key, and asserts `parse(export(doc))` deep-equals `doc` and `export(parse(export(doc)))`
equals `export(doc)`. Plus a corpus test over `hypermedia/*.md`.

Inventory to cover:

| kind             | items                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text blocks      | Paragraph, Heading, Code (`language`), Math                                                                                                                |
| media blocks     | Image (`width`, `name`, caption text), Video (`width`, `name`, `autoplay`, `loop`, `muted`), File (`name`, `size`)                                         |
| reference blocks | Embed (`view`), WebEmbed, Button (`name`, `alignment`, text), Nostr, Query (`style`, `columnCount`, `query`, `banner`, `table`)                            |
| structure        | Table / TableRow (`isHeader`) / TableColumn (`width`, `isHeader`), Slot, `childrenType` (Group, Ordered, Unordered, Blockquote), `columnCount`, `columnId` |
| annotations      | Bold, Italic, Underline, Strike, Code, Link, Embed, Range, TextColor, BackgroundColor, TextSize, TextFamily                                                |
| metadata         | every key of `HMDocumentMetadataSchema` including nested `theme`, `spaceAgents`, `schema`, `childrenSchema`, `schemaDefinition`, and passthrough keys      |

Representation rules (proposed, applied in this phase):

- Markdown-native syntax wherever it exists (headings, lists, fences, tables, images, links, emphasis).
- The existing `<!-- id:xxx -->` comment stays the identity carrier. Anything markdown cannot express is added to the
  same comment as extra keys: `type:` for a block whose markdown form is ambiguous (Video, File, Button, Embed,
  WebEmbed, Nostr, Query), and `attrs:{...}` (JSON) for attributes with no native syntax. A block with no extra keys
  looks exactly as it does today.
- Heading level is `depth + 1`; nesting under non-heading parents uses indentation, which the parser already partially
  understands.
- Style annotations (Underline, Range, TextColor, BackgroundColor, TextSize, TextFamily) use inline HTML tags with
  attributes, since markdown has no syntax for them.
- Frontmatter emits every metadata key through a YAML serializer with a fixed key order, preserving unknown keys and
  nested values.

Known bugs to fix on the way: code blocks under nested headings gain indentation on every pass; Strike and Underline are
emitted but never parsed; blockquote children are emitted but `>` lines are not parsed; Query content is dropped.

Out of scope for now: converging the desktop's separate remark-based import/export on this pair, and turning on the
desktop's markdown draft write path (which is gated on exactly this work).

### Phase 2: pull and update-push (CLI)

- Generic commands on the CLI: export a space to a directory, import a directory into a space as an update. The onyx
  naming layer (public name ↔ file basename, `onyx-` prefix stripping) sits on top.
- Schema JSON writer with fixed key order; `schemas.lock.json` stays the CID check.
- Fix the desktop publish path so a `schemaDraft` is frozen into a `schemaDefinition` blob on publish (currently
  imported but unwired in `desktop-resource.tsx`). Without this a pull cannot recover the schema.
- One-time normalization commit of `hypermedia/*.md` into the exporter's canonical form. Drop the scaffolded "Shape"
  sections, which duplicate what the Schema tab renders live from the schema blob. Delete `prepMarkdown`, since nothing
  hard-wraps anymore.

### Phase 3: local dev loop

- `onyx dev` (name TBD): dev key in a gitignored dir, register in the local daemon, push, open, watch the feed, write
  back.
- Conflict rule for v1: while the loop runs, the app is the writer and git is where you commit. Folder edits are pushed
  on start and on demand, not watched, to avoid ping-pong.

### Phase 4: publish

- `sync-onyx` uses the update-push. No other change.
