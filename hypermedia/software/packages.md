---
name: The shared packages
summary: This page describes the five TypeScript packages the Seed programs share, the block editor among them, and the rules that make documents and embeds look the same on the web and the desktop.
---
The Seed [programs](../software.md) share five TypeScript packages. A package is a folder of code that several programs use, so the code is written once. This page says what each package holds, how the block editor is built, and which package draws each part of a [document](../protocol/documents.md), a [comment](../protocol/comments.md) or an [embed](../block/embed.md).

Read this page before you change how content looks. The [desktop app](./desktop.md) and the [web app](./web.md) draw content with the same code, so one change shows in both.

# The five packages

The packages are in `frontend/packages/`. <!-- id:VuzMO9aA -->
  - **`@seed-hypermedia/client`** is the [SDK](../build/sdk.md). It depends on no UI framework, and it is published to npm. It holds Hypermedia ids and types, the code that creates and signs [blobs](../protocol/blobs.md), CBOR, the HTTP client for the [Seed API](../build/web-api.md), markdown conversion, the [query grammar](../build/query-grammar.md), [key files](../build/keys.md) and vault helpers, and the [Hypermedia Schemas](../schema.md) engine. Every app uses it, and so do the [CLI](./cli.md), the vault and the app environment. <!-- id:af1iM0fw -->
  - **`@shm/shared`** is the app layer. It holds the generated gRPC clients, the typed API router and its HTTP server adapter, the universal client (one interface for reading data on every platform), the React Query models, the routes and the translations. It is not published. <!-- id:9VA3j7ZM -->
  - **`@shm/ui`** is the React component library. It also holds page components, and the client and models for [agents](../agent.md) that the desktop, web and mobile apps share. Its general parts (buttons, form controls, dialogs, the logo and the theme) can be built as a separate npm package, `@seed-hypermedia/ui`, for services such as SeedHost. Components that belong to one app, and private workspace dependencies, stay inside the repository. [Package publishing](../contribute/package-publishing.md) explains how that package is published, and the [package README](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/ui/README.md) has the build steps. Publish the package before you update and deploy SeedHost's locked dependency. <!-- id:IH_t_sTd -->
  - **`@shm/editor`** is the [block](../protocol/blocks.md) editor. It is a fork of BlockNote on TipTap and ProseMirror, and it includes a renderer that runs on the server. <!-- id:Zr-SLVsN -->
  - **`@seed-hypermedia/apps-ui`** packages the agents screens for apps outside the repository. See [Embedding the agents UI](../build/apps-ui.md).

The first four depend on each other in one direction: `client`, then `shared`, then `ui`, then `editor`. <!-- id:YLWb2fg1 -->

Two programs are not in the pnpm workspace, so they get the packages another way:

- The [app environment](./app-environment.md) uses `client` and `shared`, and the [vault](./vault.md) uses `client`, `shared` and `ui`. Both use Bun `file:` dependencies, which copy the packages at install time. A watcher script installs them again during development.
- The [mobile app](./mobile.md) reaches `client` and the agents code that does not depend on a platform through Metro aliases. Its page explains why.

# The editor <!-- id:XL7Fa27F -->

`@shm/editor` ([`frontend/packages/editor`](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/editor)) is a TipTap 2 editor over ProseMirror, derived from BlockNote. Its ProseMirror schema has three layers: <!-- id:F1Xf8MOx -->

- `blockChildren` is a list. Its `listType` is `Group`, `Unordered`, `Ordered` or `Blockquote`. It holds `blockNode`s.
- Each `blockNode` holds one content block and, if the block has children, a `blockChildren` of its own.
- A content block is a paragraph, a heading, an image, an embed, a query and so on.

The HTML that the editor produces carries `data-node-type`, `data-content-type` and `data-id`. So styles and tests can find blocks without class names.

The stored format of a block is the SDK's `HMBlock`. The code that converts both ways is in the SDK (`hmblock-to-editorblock`), and the editor never changes that format.

Pasted HTML arrives from ProseMirror's parser as a flat list. So `transformPasted` in `BlockChildren.ts` gives it to `normalizeFragment.ts`, which builds the nested `blockNode` structure again before the editor inserts it. <!-- id:f5TvajqI -->

# Typography

One CSS class sets how text looks: `.hm-prose`. It is defined in `@shm/ui` ([`src/hm-prose.css`](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/ui/src/hm-prose.css)), on top of `@tailwindcss/typography`. It sets the fonts, the heading sizes and the space between blocks in relative units. It selects blocks by the `data-node-type` and `data-content-type` attributes. <!-- id:YnNujfvv -->

The same class is on the draft editor, the read-only viewer, embeds, comment bodies (`.hm-prose.is-comment`) and the HTML that the [web app](./web.md) renders on the server. So a document looks the same in all of them. The size classes `.hm-prose-sm`, `-base`, `-lg` and `-xl` scale a whole area.

# Server rendering

The server renders the body of a document as the same HTML the editor would produce. `renderDocumentToHTML` in [`@shm/editor/ssr-render`](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/editor/src/ssr-render.tsx) does it in these steps: <!-- id:7-g5Swd3 -->

1. It converts the blocks exactly as the editor does when it starts.
2. It turns the ProseMirror document into HTML with the schema's own `renderHTML`, through `DOMSerializer` in a happy-dom window.
3. It renders the React parts (images, embeds, [query blocks](../block/query.md)) with `react-dom/server`, from the same cache of data that the server loaded before.

The server caches the result by origin, document [version](../protocol/documents.md) and a fingerprint of the data. The page inserts it with `dangerouslySetInnerHTML`.

In the browser, the page keeps that HTML until the editor has started on top of it. Two frames later, `DocumentContentHandoff` in `@shm/ui` removes it, so the reader never sees an empty frame. The HTML is the same in both cases. So the read-only view and the editable view share one editor, and the page switches between them without starting the editor again.

The [web app](./web.md) page describes the loaders that fill the cache this renderer reads.

# Shared embed presentation <!-- id:fl7ChPJ- -->

An embed shows another resource inside a document. The web app and the desktop app use the same embed components in documents, in comments and in quotes in a discussion. The app that hosts them owns the editing controls and the navigation. It must not use a different renderer for the body, and it must not change the text style of an embed. Each part has one owner: <!-- id:kJLquXPn -->
  - `@shm/ui/embed-views` loads resources and resolves versions and routes. The Card, Link and Comments display modes keep their own shared components. <!-- id:QhqTqoz4 -->
  - `@shm/ui/content-embed` owns block selection, fragment selection, the expanded state and the place of the author. A fragment of a document expands to its block. A fragment of a comment expands to the whole comment. When the source or the range changes, the embed closes again. <!-- id:-SGzra6i -->
  - `@shm/ui/embed-wrapper` owns the source action, the green line and the caret control. Links inside the content stay separate from the link to the source. `QuotedDocBlock` looks the same but has no navigation to the source. <!-- id:R2Ae5xvh -->
  - `@shm/editor/readonly-viewer` owns block conversion, highlights, the text style of content, gallery behaviour, and the rule that the browser and the server render the same way. `EmbedEditorView` is an adapter kept for older callers. A shared context lets `ui` use the viewer without depending on the editor package. The browser code and the server code both limit how deep embeds can nest. <!-- id:9G0Fqd18 -->
  - `@shm/ui/account-avatar` owns the small and the regular form of an author's identity. An inline mention of a [profile](../profile.md) uses the same name component and keeps its inline link. The [home document](../protocol/spaces.md) of an [account](../protocol/identity.md) stays a document card. It is not a separate kind of profile card. <!-- id:UyYftm2Q -->

These rules hold in every app: <!-- id:5Ef-fu54 -->

- A full document and a comment have different text styles on purpose.
- A closed text quote or fragment shows plain text in the same small style. Opening it brings back the formatting of the source. The stored content does not change.
- An image or video embed opens its source when you click it.
- A preview keeps its aspect ratio and is at most 240 px high. When its container is at least 480 px wide, it uses half the width, up to 400 px. In a narrower container it uses the full width, still up to 400 px.
- An external video embed shows a still picture with a play button. It does not load a player.
- The root of each renderer keeps its text style apart from the comment styles around it. This uses CSS `@scope`, which Chrome 118+, Safari 17.4+ and Firefox 146+ support.

To review the embeds by eye in a way you can repeat, run `direnv exec . node frontend/packages/editor/e2e/capture-embed-gallery.mjs`. It builds the production components with fixed data. It writes an interactive HTML file, screenshots and the results of browser checks to a temporary directory of the OS. It does not start a server, and it does not replace the tests in the running web and desktop apps. <!-- id:5Isu4itX -->

# See also

- [The Seed software](../software.md), the map of the programs that use these packages.
- [The desktop app](./desktop.md) and [The web app](./web.md), the two hosts of the editor.
- [The SDK](../build/sdk.md), the public face of `@seed-hypermedia/client`.
- [Blocks](../protocol/blocks.md), the wire format the editor converts to and from.
- [Package publishing](../contribute/package-publishing.md), for the packages that reach npm.
- [Contributing](../contribute/contributing.md), for the workspace setup.
