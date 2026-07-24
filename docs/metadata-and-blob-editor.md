# Document Metadata View & Raw Blob Editor

This doc covers the work on the `document-metadata-view` branch: a metadata view/editor for documents, a GUI-first editor for raw DAG-CBOR IPFS blobs, the shared value-editor component that powers both, and the daemon/omnibar plumbing that makes `ipfs://` URLs first-class in the desktop app.

## Overview

Two user-facing features, one shared engine:

- **Metadata view** (`/:metadata`) — every document gets a Metadata view, opened from the document options dropdown. It appears as a tab next to Content/People/Comments/Citations, but stays hidden from the tab bar until active. With edit permission it is a full metadata editor; edits stage into the document draft and publish through the standard publish flow.
- **Blob editor** (`raw-blob` route, desktop only) — "New Blob" in the document options dropdown opens a dedicated page for authoring arbitrary DAG-CBOR values. Publish encodes the value as canonical DAG-CBOR, computes the CIDv1 (sha2-256), stores it on the daemon via `PublishBlobs`, and the omnibar shows the copyable `ipfs://CID` URL. Blobs are immutable: republishing an edit creates a new CID.
- **Shared value editor** (`@shm/ui/value-editor`) — the recursive GUI editor both features render, parameterized by rules so each context gets the right constraints.

## Routes & URLs

- `metadata` is a view route like `comments`/`collaborators`: `metadataRouteSchema` in `packages/shared/src/routes.ts`, the `:metadata` view term in `entity-id-url.ts`, serialization in `routeToUrl`/`routeToHmUrl`/`routeToHref`. Works on web and desktop.
- `raw-blob` is a desktop route: `{key: 'raw-blob', cid?}`. No `cid` means a new unpublished blob; after publish the route carries the CID.
- **Omnibar `ipfs://` support** (`apps/desktop/src/omnibar-url.ts`, `ipfsUrlToRoute`): pasting an `ipfs://` URL navigates. The codec is read from the CID itself, so routing is synchronous — DAG-CBOR (`0x71`) opens the blob editor, other codecs and CIDs with sub-paths open the raw IPFS inspector, invalid CIDs are ignored. Handled in both omnibar modes: focused (URL bar) and search (`SearchInput`).

## The shared value editor (`packages/ui/src/value-editor.tsx`)

A recursive tree editor for JSON-shaped values. The user never touches JSON syntax unless they explicitly ask for it (a JSON mode behind a button/menu, and a JSON type in the add-field form).

Behavior is driven by `ValueEditorRules`:

| Rule | `METADATA_VALUE_RULES` | `CBOR_VALUE_RULES` |
| --- | --- | --- |
| Lists | ✗ (SetAttribute has no list type) | ✓ full editor |
| Floats | ✗ (int64 only) | ✓ |
| Key removal | `null` tombstone (see below) | real delete |
| Null entries | hidden (mean "deleted") | visible, addable |
| IPLD links/bytes | ✗ rejected | ✓ first-class |

Editor features (all shared by both contexts):

- **Type-aware inputs**: text, whole/float numbers, toggles, nested objects, lists — commit on blur/Enter, revert on Escape.
- **Canonical key order**: keys sort per the IPLD DAG-CBOR spec (length-first, then bytewise — `dagCborKeyCompare`) at every level, in both fields and JSON modes.
- **Editable keys**: key labels display verbatim (no text-transform; keys are case-sensitive data) and rename inline with collision checks.
- **Collapse**: objects/lists get a disclosure chevron; collapsed containers show "Object · N fields" / "List · N items".
- **Selection + clipboard**: click a row to select (innermost wins). Cmd/Ctrl+C copies the value as canonical JSON, Cmd/Ctrl+V pastes over it (validated per rules; non-JSON pastes as a string), Delete removes, Escape deselects. Inert while typing in inputs; never hijacks text selections.
- **Right-click menu**: Copy, Paste, Collapse/Expand, Remove; list items add Duplicate and Move up/down.
- **Drag to reorder** list items via a grip handle (HTML5 DnD, drop-target highlight).
- **Undo/redo**: Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z via `useValueHistory` (snapshot stack, 200 steps). Consumers wire it through `ValueEditorProvider`'s `onUndo`/`onRedo`.
- **IPLD kinds** (CBOR mode): the DAG-JSON forms the daemon serves are leaf kinds, not plain maps —
  - Links `{"/": "<cid>"}`: CID-validated inline editing plus an open button (routes through `ipfsUrlToRoute`).
  - Bytes `{"/": {"bytes": "<base64>"}}`: size readout, download, replace-from-file. Base64 decoding accepts padded and unpadded; we emit unpadded per spec.
  - The add-field form offers Link (CID or `ipfs://` input) and Bytes (file picker) types.

Pure helpers live in `packages/ui/src/dag-json.ts`: form detection, base64 codecs, `formatByteSize`, and `dagJsonToIpld`.

## Metadata publish semantics (important)

Publish ops are generated from the draft metadata **without a base document** (`getDocAttributeChanges(draft.metadata)`), so a key that simply disappears from the draft emits no op and the previously published value survives. Therefore:

- Removing a key (at any depth) stages an explicit `null` **tombstone**, which publishes a `nullValue` attribute op and actually clears it.
- Renaming stages `{oldKey: null, newKey: value}`.
- The JSON-mode diff (`diffMetadata` in `document-metadata-view.tsx`) preserves existing tombstones across unrelated edits, so a staged deletion can't be resurrected by editing a sibling field.
- Undo works on snapshots of the merged metadata and applies `diffMetadata(current, snapshot)` — so undo itself flows through the same staged-patch path.

The metadata editor stages patches via the document machine (`beginEditIfNeeded()` + `send({type: 'change', metadata: patch})`), the same path as the Document Settings panel, and the standard save indicator + publish toolbar render on the metadata view (both platforms).

## Blob editor publish path (`apps/desktop/src/pages/raw-blob.tsx`)

```
value (DAG-JSON forms) → dagJsonToIpld → CID instances + Uint8Array
  → @ipld/dag-cbor encode (canonical, sorted keys)
  → sha2-256 digest → CIDv1(0x71)
  → client.request('PublishBlobs', {blobs: [{cid, data}]})   // daemon verifies cid matches data
  → replace route to {key: 'raw-blob', cid} → omnibar shows ipfs://CID
```

The `dagJsonToIpld` step is load-bearing: without it, republishing a blob containing links or bytes would corrupt them into plain maps (a JS `{"/": cid}` object is not a link to the CBOR encoder). Covered by an encode/decode round-trip test.

Reading uses `useCID` → `GET /ipfs/{cid}.dagjson` (daemon decodes CBOR → DAG-JSON). Non-CBOR CIDs get a fallback with "Open in Inspector"; decode failures show a searching state.

## Daemon: network discovery for `.dagjson` (`backend/daemon/http.go`, `backend/hmnet/filemanager.go`)

`GET /ipfs/{cid}.dagjson` previously read straight from the local blockstore — a blob not already on the node failed instantly with no discovery attempt. It now fetches through the bitswap-backed block service (`FileManager.GetBlock`), the same path as the raw `/ipfs/{cid}` file endpoint: local store first, then connected peers and the network, with a 30s search timeout (408 on timeout instead of 404). The blob editor shows "Searching your node and the IPFS network…" while loading and auto-retries every 10s when not found yet, so content appears as soon as the node discovers it.

## Known limitations / future work

- **Lists in metadata**: the `SetAttribute` gRPC op has no list value type (string/int64/bool/null only; the Go API panics on anything else), so lists are disabled in the metadata editor. The CBOR blob layer (`KeyValue.Value any`) supports them — adding a list case to the proto, `documents.go`, and `pushAttributeChanges` would enable them end to end.
- **Blob editor is desktop-only** (route, page, omnibar). The primitives (`PublishBlobs`, `useCID`, the shared editor) all work on web if a web surface is wanted later.
- **DAG-JSON edge cases**: maps that legitimately contain a single `"/"` key are indistinguishable from the link/bytes forms in DAG-JSON (a spec-level reservation, not ours). CBOR tags other than 42 and non-string map keys are not represented.
- Publishing a blob stores it on the local node; propagation to other nodes happens via standard bitswap discovery when they request the CID.

## Testing

- `packages/shared` route/URL tests: `:metadata` parse/serialize round-trips.
- `packages/ui`: `document-metadata-view.test.ts` (DAG-CBOR key ordering, tombstone diffing), `dag-json.test.ts` (form detection, base64, `dagJsonToIpld`, rule validation).
- `apps/desktop`: `omnibar-ipfs-url.test.ts` (ipfs URL routing by codec), `raw-blob-encoding.test.ts` (CBOR round-trip of links/bytes).
- `backend/daemon`: `http_test.go` runs the dagjson handler through a real `FileManager` with an offline exchange.
