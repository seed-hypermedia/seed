---
name: The shared packages
summary: The four TypeScript packages every Seed program builds on, the block editor among them, and the rules that make documents and embeds look the same on web and desktop.
---
The Seed [programs](../software.md) share four TypeScript packages. This page says what each package holds, how the block editor is built, and which package owns each part of rendering a [document](../protocol/documents.md), a [comment](../protocol/comments.md) or an [embed](../protocol/blocks.md). Read it before changing how content looks, because the [desktop app](./desktop.md) and the [web app](./web.md) render through the same code.

# The four packages

Four TypeScript packages sit under the apps, in `frontend/packages/`. <!-- id:VuzMO9aA -->
  - **`@seed-hypermedia/client`**, the [SDK](../build/sdk.md). It has no framework dependency and is published to npm. It holds Hypermedia ids and types, [blob](../protocol/blobs.md) creation and signing, CBOR, the HTTP client for the [Seed API](../build/web-api.md), markdown conversion, the [query grammar](../build/query-grammar.md), [key files](../build/keys.md) and vault helpers, and the [Hypermedia Schemas](../schema.md) engine. Every app uses it, and so do the CLI, the vault and the app environment. <!-- id:af1iM0fw -->
  - **`@shm/shared`**, the app layer: generated gRPC clients, the typed API router and its HTTP server adapter, the universal client abstraction, React Query models, routes and translations. It is not published. <!-- id:9VA3j7ZM -->
  - **`@shm/ui`**, the React component library, page components, and the shared agents client and models used by desktop, web and mobile. Its reusable buttons, form controls, dialogs, logo and theme can be built as a standalone npm package for services such as SeedHost. Application-specific components and private workspace dependencies stay inside the monorepo; see the [package build and release instructions](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/ui/README.md). The **Publish UI package** workflow validates changes on pull requests and main; an explicit version-confirmed run on main publishes the tested tarball to npm. Publish the package before updating and deploying SeedHost's locked dependency. <!-- id:IH_t_sTd -->
  - **`@shm/editor`**, the block editor, a BlockNote fork on TipTap and ProseMirror, with a server-side renderer. <!-- id:Zr-SLVsN -->

The dependency direction is client, then shared, then ui, then editor. The [vault](./vault.md) and the [app environment](./app-environment.md) consume `client` and `shared` through Bun `file:` dependencies, which copy the packages at install time. A watcher script reinstalls them during development. <!-- id:YLWb2fg1 -->

The [mobile app](./mobile.md) sits outside the pnpm workspace and reaches `client` and the platform-neutral agents code through Metro aliases. Its page explains why.

# The editor <!-- id:XL7Fa27F -->

`@shm/editor` ([`frontend/packages/editor`](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/editor)) is a TipTap 2 editor over ProseMirror, derived from BlockNote. Its ProseMirror schema is three layers: `blockChildren` (a list with a `listType` of `Group`, `Unordered`, `Ordered` or `Blockquote`) holds `blockNode`s, and each `blockNode` holds one content block (paragraph, heading, image, embed, query and so on) and an optional `blockChildren` of its own. The rendered DOM carries `data-node-type`, `data-content-type` and `data-id` so styles and tests can target blocks without depending on class names. The [block](../protocol/blocks.md) format on the wire is the SDK's `HMBlock`; the conversion both ways lives in the [SDK](../build/sdk.md) (`hmblock-to-editorblock`), and the editor never changes it. <!-- id:F1Xf8MOx -->

Pasted HTML arrives from ProseMirror's parser as a flat list, so `transformPasted` in `BlockChildren.ts` hands it to `normalizeFragment.ts`, which rebuilds the nested `blockNode` structure before insertion. <!-- id:f5TvajqI -->

# Typography

Typography is one class. `.hm-prose`, defined in `@shm/ui` ([`src/hm-prose.css`](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/ui/src/hm-prose.css)) on top of `@tailwindcss/typography`, sets the font stacks, heading scale and block rhythm in relative units, keyed off the `data-node-type` and `data-content-type` attributes. The same class is applied to the draft editor, the read-only viewer, embeds, comment bodies (`.hm-prose.is-comment`) and the server-rendered HTML on the [web](./web.md), so a document looks the same in all of them. Size modifiers `.hm-prose-sm`, `-base`, `-lg` and `-xl` scale a whole surface. <!-- id:YnNujfvv -->

# Server rendering

The document body itself is server-rendered as real editor markup by `renderDocumentToHTML` in [`@shm/editor/ssr-render`](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/editor/src/ssr-render.tsx). It converts the blocks exactly as the editor does at mount, serializes the ProseMirror document with the schema's own `renderHTML` through `DOMSerializer` in a happy-dom window, and renders the React node views (images, embeds, query blocks) with `react-dom/server` from the same prefetched cache. The result is cached per origin, document version and data fingerprint and injected with `dangerouslySetInnerHTML`. The page keeps that placeholder until the editor has mounted over it, then `DocumentContentHandoff` in `@shm/ui` lifts it two frames later, so the swap does not paint a blank frame. Because the markup is identical, read-only and editable views share one editor instance and switch without a remount. <!-- id:7-g5Swd3 -->

The [web app](./web.md) page describes the loaders that fill the cache this renderer reads from.

# Shared embed presentation <!-- id:fl7ChPJ- -->

Web and desktop use the same content embed components in documents, comments, and discussion quotes. The host owns editing controls and navigation services. It must not supply a different body renderer or override embed typography. <!-- id:kJLquXPn -->
  - `@shm/ui/embed-views` loads resources and resolves versions and routes. Card, Link, and Comments display modes retain their existing shared components. <!-- id:QhqTqoz4 -->
  - `@shm/ui/content-embed` owns block selection, fragment selection, expansion state, and author placement. A document fragment expands to its block. A comment fragment expands to the whole comment. A source or range change resets expansion. <!-- id:-SGzra6i -->
  - `@shm/ui/embed-wrapper` owns the source action, green rule, and caret control. Links within the content remain separate from the source link. `QuotedDocBlock` uses the same presentation with source navigation disabled. <!-- id:R2Ae5xvh -->
  - `@shm/editor/readonly-viewer` owns block conversion, highlights, content typography, gallery behavior, and the browser/server rendering contract. `EmbedEditorView` is a compatibility adapter. The shared context avoids a UI-to-editor dependency. Browser and server implementations both limit nested embed depth. <!-- id:9G0Fqd18 -->
  - `@shm/ui/account-avatar` owns compact and regular author identity. Inline profile mentions share the name primitive and retain their inline link behavior. An account home document remains a document card; it is not a separate profile-card type. <!-- id:UyYftm2Q -->

Full document and comment typography are intentional content variants. Collapsed text block quotes and fragments use plain text with the same small text style in every host. Expansion restores the source formatting without changing the stored content. Image and video block embeds open their source; previews preserve aspect ratio, have a 240 px media height limit, and use half the available width (up to 400 px) when their container is at least 480 px wide. Narrower containers use the available width, still capped at 400 px. External video embeds show a static play preview rather than loading a player. Renderer roots isolate typography from surrounding comment styles. This isolation uses CSS `@scope`, supported by Chrome 118+, Safari 17.4+, and Firefox 146+. <!-- id:5Ef-fu54 -->

For a repeatable visual review, run `direnv exec . node frontend/packages/editor/e2e/capture-embed-gallery.mjs`. It builds production components with fixed resource data and writes an interactive HTML file, screenshots, and browser check results to an OS temporary directory. It does not start a server or replace tests in the running web and desktop apps. <!-- id:5Isu4itX -->

# See also

- [The Seed software](../software.md), the map of the programs that use these packages.
- [The desktop app](./desktop.md) and [The web app](./web.md), the two hosts of the editor.
- [The SDK](../build/sdk.md), the public face of `@seed-hypermedia/client`.
- [Blocks](../protocol/blocks.md), the wire format the editor converts to and from.
- [Contributing](../contribute/contributing.md), for the workspace setup.
