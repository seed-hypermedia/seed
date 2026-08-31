# Extensions — Roadmap and overlap with other extension kinds

The team's [Types of Extensibility](https://seedteamtalks.hyper.media/tech/types-of-extensibility) lists APIs, SDK,
Services, Tools, Block UI, Custom Block, Custom Attribute UI, Custom Document/Resource UI, Custom Page, Theming, Custom
Indexer, and two UI modalities (iframe vs. template). This branch ships **Custom Page** and builds the layers below so
the others are increments, not rewrites.

## What is kind-agnostic (built now)

| Layer                                                    | Where                                                    | Reused by                        |
| -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- |
| Packaging: extension document + manifest + IPFS entry    | `client/src/extensions.ts`, `seed-cli extension publish` | all kinds                        |
| Install records on the home document, pinning, update    | `metadata.extensions`, desktop Site settings, CLI        | all kinds                        |
| Sandboxed frame + bridge server + permission enforcement | `@shm/ui/extensions`                                     | block, attribute UI, document UI |
| Signing confirmation dialog, session allow               | `@shm/ui/extensions/sign-confirm-dialog`                 | anything that writes             |
| Extension SDK                                            | `@seed-hypermedia/extension-sdk`                         | all iframe kinds                 |
| Dev overrides                                            | localStorage + `?extdev=`                                | all kinds                        |

## Next kinds, in suggested order

1. **Custom Document/Resource UI** (`kind: 'document'`) — the smallest step: an install record that binds an extension
   to a _document_ (or a folder) instead of a mount path, so `/notes/roadmap` renders the extension with
   `context.document` set. Reuses `ExtensionPage` wholesale; adds `document` to the context and a `document.*`
   convenience on the bridge. Kanban already models this: its state is the document at its mount.
2. **Custom Block** (`kind: 'block'`) — manifest gains `contributes.blocks: [{type, name, icon, attributes schema}]`.
   The editor's `hmBlockSchema` becomes a function of installed extensions; each custom block renders an
   `ExtensionFrame` with `ui.resize` honoured and the block's attributes in context; new bridge method
   `block.setAttributes`. Needs lazy mounting and a per-document frame cap.
3. **Block UI override** — same as above, keyed on an existing type.
4. **Custom Attribute UI** (`kind: 'attribute'`) — frame mounted in the metadata editor for a named attribute;
   `attribute.get/set` bridge methods.
5. **Theme** (`kind: 'theme'`) — no code: manifest carries CSS custom properties and header options. Install = the same
   record; host applies variables.
6. **Template modality** — a second host that implements the same bridge with native components (for mobile and for
   consistency). The SDK stays the same; `connect()` detects the host.

## Things pages will want soon

- Extension mounts in site navigation (web header) and desktop sidebar.
- `nav: false` mounts as "hidden tools".
- Per-viewer `settings` in addition to site `settings`.
- A `document.subscribe` bridge event so extensions re-render on new versions.
- An extension directory page on the network (search `seedExtension` manifests).
- `seed-cli extension dev` to serve a built `dist/` with the right CORS headers.

## Open questions

- Should installs be per-_document_ capabilities rather than home-document metadata so collaborators without home write
  access can install on their subtree?
- Should the host honour a `csp` field in the manifest to restrict the frame's own egress (`Content-Security-Policy`
  meta in srcdoc)?
- Do we want a "verified publisher" signal (author contact + site membership) in the install UI?
