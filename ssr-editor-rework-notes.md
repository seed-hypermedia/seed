# SSR Editor Rework — Working Notes

Goal: replace the hand-written string SSR renderer (`frontend/packages/editor/src/ssr-render.ts`)
with a solution that generates the document's pre-hydration HTML from the SAME sources of truth
the client editor uses, so nothing needs manual syncing:

1. Block scaffolding: ProseMirror `DOMSerializer.fromSchema(schema)` executing the same
   BlockNote schema `toDOM`/`renderHTML` definitions, in Node (happy-dom/jsdom document).
2. Custom block content (query blocks, embeds, buttons, …): `renderToString` of the SAME React
   components the editor node views render, fed by the SAME prefetched React Query cache the
   loader already builds.

Constraints from Eric:
- Do NOT drop the editor for read-only views: documents switch editable<->read-only live and
  must not remount/flash. The editor still mounts once and swaps the SSR placeholder; the swap
  must be pixel-invisible (verified by the Playwright pixel harness).
- Net less code than the string renderer approach.
- Test against real data: site z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno
  (seedteamtalks.hyper.media), set in frontend/apps/web/config.json.

## State

- [x] Stashed prior string-renderer work: `git stash list` → stash@{0}
      "query-block SSR via string-renderer: pixel-parity cards, read-only selection fix,
      500px focus-button gate, collaborators prefetch, header-height CSS var".
      NOTE: that stash contains four ORTHOGONAL bug fixes that must be re-applied as part of
      this project (they are required for pixel parity and were verified good):
        1. block-selection-wrapper.tsx: no selection chrome in read-only unfocused editor
           (+ tests, + mock updates in button.test.tsx)
        2. document-editor.tsx: gate 500px "Focus editor at end" button on canEdit
        3. loaders.ts: prefetch queryDocumentCollaborators (People tab count)
        4. resource-page-common.tsx + web styles.css: data-header-layout attr + responsive
           --site-header-default-h defaults (65px/81px bar, 96px center)
      Recover pieces with: git diff stash@{0}^ stash@{0} -- <file>
- [x] config.json switched to seedteamtalks uid (old uid parked as ERIC_registeredAccountUid).
      Content synced immediately (daemon already had it). Site title "Develop Seed Hypermedia".
- [x] Test page set chosen (block-type coverage from crawling the real site):
      /                                   query cards + site nav
      /notes, /issues                     query blocks (list/card)
      /projects                           query + embeds + headings
      /design                             12 embeds
      /tech-talks/document-block-types    headings + code blocks
      /tech-talks/ssr-performance-optimization-plan   190+ blocks, code (stress test)
      /notes/datoms-and-rdf               18 code blocks
      /notes/knowledge-base-sketches-and-ideas        images
      /tech-talks/improving-editor-block-rendering    images
      /tech-talks/system-components       'unknown' block type + 12 embeds (error-path coverage)
      (no video/math/button/web-embed found on this site — cover those via unit tests)
- [x] Baseline parity captured on current main (string renderer), 1280x2000, via
      frontend/apps/web/scripts/ssr-parity-check.mjs → /tmp/ssr-parity-baseline:
        /              2.451%   /notes                1.221%   /issues   1.040%
        /design        4.574%   /tech-talks/document-block-types 0.940%
        /tech-talks/ssr-performance-optimization-plan 1.962%
        /notes/datoms-and-rdf 1.239%   /notes/knowledge-base-sketches-and-ideas 2.558%
        /tech-talks/improving-editor-block-rendering 2.058%
        /tech-talks/system-components 1.792%   /tech-talks/performance 1.639%
      (/projects timed out on networkidle — embeds keep connections open; harness may need
      'load' + fixed-wait fallback for that page)
      TARGET: 0px on all of these.
- [x] Research phase (workflow, 5 agents): feasibility CONFIRMED, empirically probed.
- [x] Design (below)
- [ ] Implement
- [ ] Verify: pixel harness on multiple real pages (0px goal at ≥768px widths)
- [ ] Cleanup: delete string renderer + imitation CSS; net-code accounting

## Key prior findings (from the string-renderer round, still valid)

- Bug mechanics: loader prefetches query-block payloads into React Query cache (dehydrated to
  client), but the SSR HTML placeholder didn't render them → flash.
- ProseMirror cannot hydrate/adopt existing DOM; EditorView always rebuilds. The mount-time
  swap is inherent; pixel-identical markup makes it invisible. Verified 0px diff is achievable.
- The /posts-style pages' PM initial selection lands on the first selectable node (doc with
  only a query block) → read-only selection ring bug (fix #1 above).
- Pixel harness: /tmp/layout-compare2.mjs pattern — JS-disabled vs hydrated screenshots +
  pixelmatch + per-element geometry diff. Rebuild as a committed test script this round.
- Editor DOM root observed on web: div.ProseMirror._bnEditor…_bnRoot… inside
  div.mantine-Editor-root.hm-prose.draft-editor.
- Query block hydrated DOM: BlockSelectionWrapper div > div.group.relative.-mx-4.px-4 >
  click-isolation div > QueryBlockContent (DocumentCardGrid → DocumentCard from @shm/ui).

## Open questions (research phase to answer)

1. Can the tiptap/BlockNote PM schema be constructed headless in Node (no EditorView, no DOM)?
   Any window/document access at module load in the editor package import graph?
2. Which vendored BlockNote conversion utilities exist: editor blocks → PM nodes
   (blockToNode?), HM blocks → editor blocks (hmblock-to-editorblock), HTML serializer?
3. Full inventory of block types: which are plain renderHTML (serializable via DOMSerializer)
   vs React node views (need renderToString), and what hooks/contexts those components need.
4. What providers does renderToString need in the loader (QueryClientProvider with prefetch
   cache, UniversalAppContext, routing for useRouteLink), and do any touch window at render.
5. Which CSS styles the editor DOM (Block.module.css hashed classes? hm-prose.css?) — can the
   ssr-content-placeholder imitation CSS in web styles.css be deleted wholesale?
6. How the ssrContentHTML placeholder is injected & swapped on the web (component, classes),
   so the SSR wrapper element can carry the same classes as the live editor root.

## Research results (condensed; full transcript in workflow output)

PROVEN (agent A ran a real Node probe):
- `getSchema(extensions)` from @tiptap/core 2.0.3 builds the full PM schema headless from
  `getBlockNoteExtensions({editor: stubEditor, blockSpecs: hmBlockSchema, ...})` — no DOM,
  no EditorView. All 13 web block specs instantiate (paragraph, heading, code-block, file,
  image, video, button, math, web-embed, embed, query, table, unknown).
- `blockToNode(block, schema)` (blocknote/core/api/nodeConversions/nodeConversions.ts:128)
  + doc recipe from BlockNoteEditor.ts:359-374:
  `schema.node('doc', undefined, schema.node('blockChildren', {listType: rootChildrenType || 'Group'}, nodes))`
- `DOMSerializer.fromSchema(schema).serializeFragment(doc.content, {document}, target)`
  (prosemirror-model 1.25.4) emits the REAL hashed CSS-module classes (deterministic per
  build, shared Vite module graph server+client).
- Gotcha 1: import cycle TDZ — must import the `./blocknote` core barrel BEFORE `./schema`.
- Gotcha 2: custom-block `render()` (block.ts:80) uses GLOBAL document.createElement; the
  DOMSerializer {document} option only covers array-form specs. Scope a global
  `globalThis.document` around the synchronous serialize call (set/restore in try/finally).

HM→editor conversion (agent D): `hmBlocksToEditorContent(blocks, {})` in
frontend/packages/client/src/hmblock-to-editorblock.ts — pure data transform, server-safe.
(Its opts.childrenType param is dead code.) Client default: rootChildrenType
`(ctx.metadata?.childrenType ?? document.metadata?.childrenType) || 'Group'`.
Empty content falls back to `[{type: 'paragraph'}]` (document-editor.tsx:209-219).

DOM parity gaps (agents B+E) — the post-processing work list:
1. React custom blocks (image, video, file, button, math, web-embed, embed, query, unknown):
   schema renderHTML emits bare `div[data-content-type=X][data-*]` (+ inner contentDOM div
   when containsInlineContent). Live editor emits
   `div.{reactNodeViewRenderer}` > `div.{blockContent}[data-content-type=X][data-*]` > React output,
   with contentDOM (caption) nested where NodeViewContent sits.
   → Post-process each such container: rebuild wrapper structure with hashed classes
   (bnBlockStyles from blocknote core), renderToString the SAME block component inside,
   and move the serialized inline-content (caption HTML w/ marks) into the
   `[data-node-view-content]` slot.
2. code-block: highlighting is LowlightPlugin DECORATIONS — absent from DOMSerializer
   output. Post-process: run the same lowlight over the code text and emit the same span
   classes the plugin produces (18-code-block test page /notes/datoms-and-rdf will verify).
3. heading: DOMSerializer output is CORRECT (h-tag IS the blockContent) — the old string
   renderer's div>h structure was a drift. Free fix.
4. table: colgroup widths only from TableView node view; no tables on test site — accept,
   note limitation.
5. Links: serialized marks carry hm:// hrefs. Pixel-identical; but rewrite hrefs via
   renderHref in post-processing for SEO/no-JS usability (href doesn't affect pixels).

React block SSR-safety issues found (agent B):
- BlockSelectionWrapper: useState initializer → computeSelected → editor._tiptapEditor.view.
  Stub editor needs `_tiptapEditor: {view: {state: {selection: {}}, hasFocus: () => false}}`;
  the stashed read-only guard (isEditable&&hasFocus) also short-circuits this.
- image.tsx:290/426 + video.tsx:340/354 read editor.domElement.firstElementChild.clientWidth
  in the render body → needs a small guard (fallback width) or stub domElement.
- query block: LazyViewportMount initializes inactive → renderToString emits empty div.
  Server branch: render children when `typeof window === 'undefined'` (safe: the SSR string
  is injected via dangerouslySetInnerHTML and never React-hydrated, so server/client render
  divergence in these components cannot cause hydration mismatches).
- embed with view=Content: EmbedEditorView constructs a NESTED BlockNoteEditor during
  render — cannot renderToString. Server branch: recursively serialize the referenced doc's
  content (already in the prefetched cache) through this same pipeline, threaded via context.
- web-embed (tweets): legitimately empty server-side (3rd-party scripts) — accept.
- math: katex renders only in useEffect → empty on server; add katex.renderToString server
  branch (no math blocks on test site; unit-test only).
- nostr: NOT in the web schema — out of scope.

Provider harness for renderToString (agents B+C):
- REQUIRED: QueryClientProvider(prefetchCtx.queryClient) — hooks read prefetched data
  synchronously; UniversalAppProvider (pure Context.Provider, no window access at render)
  with {universalClient: serverUniversalClient, origin, originHomeId, openUrl noop,
  getOptimizedImageUrl, ipfsFileUrl: DAEMON_FILE_URL}.
- Null-safe without providers: useEditorGate (canEdit=false → all edit chrome skipped),
  useDocumentActions, useDraftActions, useQueryBlockDrafts, usePopoverState,
  useQueryBlockFrontendPerf.
- NavContext: provide a static writeableStateStream if any embed view calls useNavigate.
- Precedent exists: apps/web/app/ssr-document.integration.test.ts renderToStrings
  ResourcePage with QueryClientProvider+TooltipProvider.

CSS (agent E) — CRITICAL deployment detail:
- Block.module.css / editor.module.css / editor.css are today bundled ONLY into the lazy
  document-editor chunk → at SSR first paint they are NOT loaded. The new SSR HTML carries
  hashed module classes that would be unstyled until the chunk arrives.
  → Add an eager style entry: the web app root imports the editor's block/editor CSS
  (new `@shm/editor/editor-styles` export with only CSS imports). Same Vite graph ⇒ hashed
  names in loader-serialized HTML match the eager stylesheet.
- hm-prose.css is already eager (tailwind.css imports it) and keys on data-attrs.
- After migration, nearly ALL .ssr-content-placeholder imitation rules in web styles.css
  die (each rule group mapped to its real source — see agent E finding Q2). Keep only a
  root-width rule if needed. `.ssr-card`/`.ssr-query-block` rules die entirely.
- Live wrapper stack: div.mantine-Editor-root.hm-prose.draft-editor >
  div.ProseMirror.{bnEditor}.{bnRoot}.{defaultStyles}. mantine classes are empty/JS-injected
  (not needed); emit `<div class="hm-prose draft-editor"><div class="ProseMirror {bnEditor} {bnRoot} {defaultStyles}">…`
  for topology parity (hm-prose :has() selectors depend on structure).

Swap mechanism (agent C): web-resource-page.tsx:108-116 dynamic-imports DocumentEditor in
useEffect; resource-page-common.tsx:2827-2849 ternary swaps dangerouslySetInnerHTML div for
the editor in one commit. No signal needed; parity makes it invisible. ssrContentHTML must
remain a STRING through the loader (React never diffs inside dangerouslySetInnerHTML).

## Design

New module: frontend/packages/editor/src/ssr-render.tsx (replaces ssr-render.ts entirely).

    renderDocumentToHTML(blocks: HMBlockNode[], opts: {
      cacheKey?: string
      rootChildrenType?: HMBlockChildrenType
      renderHref?: (url: string) => string | null | undefined   // SEO href rewrite
      queryClient: QueryClient          // the loader's prefetch cache
      appContext: {origin, originHomeId, universalClient, ipfsFileUrl, getOptimizedImageUrl}
    }): string | null

Pipeline inside:
1. editorBlocks = hmBlocksToEditorContent(blocks, {}) (fallback [{type:'paragraph'}])
2. pmDoc = schema.node('doc', undefined, schema.node('blockChildren',
   {listType: rootChildrenType || 'Group'}, editorBlocks.map(b => blockToNode(b, schema))))
   — schema built once via getSchema(getBlockNoteExtensions({editor: stub, ...}))
3. Serialize with DOMSerializer.fromSchema into a happy-dom document
   (scoped globalThis.document during the call).
4. Post-process in the happy-dom tree:
   a. For each React block container div[data-content-type=X in REACT_TYPES]:
      wrap in reactNodeViewRenderer/blockContent structure, renderToString(<Providers>
      <BlockRender block editorStub/></Providers>), inject; move serialized caption into
      [data-node-view-content].
   b. code-block: lowlight highlight injection (same classes as LowlightPlugin).
   c. rewrite a[href^="hm://"] via renderHref.
5. Wrap: <div class="hm-prose draft-editor"><div class="ProseMirror ..hashed..">…</div></div>
6. Version+query-fingerprint-keyed LRU cache (learned from round 1: query results change
   independently of doc version — fingerprint the query-block cache entries into the key).

loaders.ts: drop the embeds/queries map building (components read the cache directly);
pass queryClient + appContext. Keep prefetch waves; ADD collaborators prefetch (stash fix).

Component patches (all tiny, all single-source):
- LazyViewportMount: render children on server.
- image/video: guard getEditorWidth DOM read.
- embed Content view: server branch renders recursively-serialized embedded doc via context.
- math: katex.renderToString server branch.
- Re-apply stash fixes: block-selection-wrapper guard (+tests), 500px focus-button gate,
  header-height CSS var + data-header-layout, collaborators prefetch.

Web app: eager-import editor styles (new @shm/editor/editor-styles); delete imitation CSS.

Block component registry: export a `type → Render` map — block specs already hold their
render fns; if createReactBlockSpec doesn't expose them, export the render functions from
each block module (still single-source).

Testing: unit tests for the new module (all 13 block types + annotations + lists + grid),
ssr-parity-check.mjs against the 12-page seedteamtalks set, typecheck everywhere.

## Implementation log (2026-07-08, session 1)

CORE PIPELINE DONE AND WORKING on real seedteamtalks data. Final sweep:
  /                0.021%   /notes    0.007%   /issues 0.013%   /design 0.001%
  /tech-talks/document-block-types 0px    ssr-performance-optimization-plan 6px
  /notes/datoms-and-rdf 18px   improving-editor-block-rendering 0px
  /tech-talks/system-components 0px   /tech-talks/performance 0px
  REMAINING: /projects 2.057%  /notes/knowledge-base-sketches-and-ideas 0.568%
  (baseline before rework was 1–4.6% on EVERY page)
The ≤0.02% residues are live-data churn (relative timestamps change between the
two screenshots) — not systematic.

What was built (all typechecked; probe tests in ssr-probe.test.tsx pass):
- frontend/packages/editor/src/ssr-render.tsx — NEW pipeline:
  hmBlocksToEditorContent → blockToNode → doc recipe (BlockNoteEditor.onBeforeCreate)
  → DOMSerializer.fromSchema(getSchema(getBlockNoteExtensions({editor: stub})))
  into happy-dom (scoped globalThis.document in try/finally) → post-passes:
  1. renderReactBlocks: for each spec with .render (exposed via
     createReactBlockSpec, ReactBlockSpec.tsx + blockTypes.ts BlockSpec.render),
     renderToString with providers:
     QueryClientProvider(loader cache) > UniversalAppProvider(appContext)
     > NavContextProvider(static stream) > TooltipProvider
     > DocumentActionsProvider(onCopyLink noop — makes the "..." options button
     render like the web's anonymous-reader page)
     then replaceWithNodeView(): div.react-renderer.node-<type>.{reactNodeViewRenderer}
     > div.{blockContent}[data-node-view-wrapper][white-space:normal][data-*]
     with serialized inline content moved into [data-node-view-content].
     Editor stub: isEditable false, _tiptapEditor.view {state:{selection:{}},
     hasFocus:()=>false}, domElement.firstElementChild.clientWidth = opts.editorWidth.
     Errors set data-ssr-error attr on the container (great for debugging).
  2. renderCodeBlocks: language read from blockById (attr is rendered:false!),
     CodeBlockScroller (shared chrome exported from code-block-view.tsx),
     getHighlightRuns (exported from lowlight-plugin.ts — same tokenizer as the
     live decorations); runs-must-reproduce-text guard else plain; trailing
     <br class="ProseMirror-trailingBreak"> when text ends with \n.
  3. addTrailingBreaks: empty p/h1-h6/[data-node-view-content]>div get the
     ProseMirror trailing break (empty paragraphs collapse otherwise).
  4. rewriteLinkHrefs: hm:// → renderHref (SEO; pixel-neutral).
  Wrapper: div.ssr-content-placeholder.hm-prose.draft-editor >
  div.ProseMirror.{bnEditor}.{bnRoot}.{defaultStyles} with inline
  position:relative; word-wrap:break-word; white-space:break-spaces (PM injects
  this via JS at runtime; needed for identical line wrapping).
- query-block-input.ts (NEW, dependency-free): getQueryBlockInput — THE cache
  key derivation shared by query-block.tsx useQuery and the loader prefetch.
  (Old loader prefetch key NEVER matched the component's — original flash bug.)
  Import-cycle warning: importing ./query-block or ./schema first crashes (TDZ);
  ssr-render.tsx imports ./blocknote barrel first. query-block-input is safe.
- editor-styles.ts (NEW): eager CSS entry (Block.module.css, editor.module.css,
  editor.css, image.css, inline-embed.css) imported by web root.tsx — otherwise
  SSR HTML is unstyled until the lazy editor chunk loads.
- image.tsx/video.tsx: getEditorWidth guarded (?. + FALLBACK_EDITOR_WIDTH in
  media-render.tsx); loaders passes editorWidth = contentWidth(S600/M700/L900)-32.
- LazyViewportMount: renders children when typeof window === 'undefined'.
- loaders.ts: prefetch waves — wave2 query-block inputs via getQueryBlockInput +
  hmBlockToEditorBlock; NEW wave3 = interaction summaries for query results
  (capped 30), home directory children, and embed refs (chips/comment counts);
  collaborators prefetch (stash fix); cacheKey = version + djb2 fingerprint of
  query payloads (stringifyWithBigInt — daemon payloads contain bigints).
- ui/layout.tsx: wrapperProps maxWidth — the gtSm +44px is now CSS
  (--doc-gtsm-bonus in hm-prose.css, media min-width:861px) for sidebar-less
  (home) layouts so SSR center == hydrated center; sidebar'd layouts keep the
  JS +44 (their SSR/hydrated alignment relies on the old asymmetry).
- Stash fixes re-applied via git checkout stash@{0}: block-selection-wrapper
  (+tests), document-editor 500px gate, resource-page-common data-header-layout;
  web styles.css: imitation CSS DELETED (314→109 lines), header defaults added.

REMAINING WORK (next session):
1. /projects 2.06%: SSR vs hydrated show query/embed items in DIFFERENT ORDER
   (ghost titles swap positions). Likely the client REFETCHES on mount (stale
   query) and the daemon returns a different order, or sort input mismatch.
   Investigate: compare SSR payload order vs client's refetched order; consider
   dehydrated staleTime so client doesn't refetch immediately.
2. /notes/knowledge-base-sketches 0.568%: vertical offsets around px/%-width
   images mid-page (~25px). Whether image height rounding or a caption/trailing
   break issue — compare the image block DOM/heights both modes (pattern:
   /tmp/cmp-*.mjs scripts).
3. Unknown-block probe test asserts + real unit tests to replace ssr-probe.test.tsx;
   delete data-ssr-error? NO — keep (documented diagnostic).
4. Cleanup: remove /tmp scripts; prettier all changed files; run editor+shared
   test suites; net-code accounting (old ssr-render.ts was ~485 lines + ~200
   lines imitation CSS deleted; new ssr-render.tsx ~420 incl providers).
5. math katex server branch + embed view=Content nested doc — NOT hit on this
   site's pages; document as known limitations or implement.
6. Consider making htmlCache key include editorWidth (correctness if contentWidth
   changes without version change — it can't; version covers it. fine).
7. Run parity at 900/768 widths + posts site config restore?? (config.json still
   points at seedteamtalks — Eric asked for this site, leave it.)
Harness: node frontend/apps/web/scripts/ssr-parity-check.mjs --out /tmp/x [paths]
NOTE dev-iteration gotcha: ssr-render's htmlCache is version-keyed; after
editing loaders-only inputs, `touch packages/editor/src/ssr-render.tsx` to bust.

## FINAL RESULTS (2026-07-08)

All 12 real seedteamtalks pages, 1280x2000 (residuals are live-data churn —
relative timestamps changed between the two captures — not systematic):
  /                                    0.021%   (was 2.451%)
  /notes                               0.007%   (was 1.221%)
  /issues                              0.013%   (was 1.040%)
  /projects                            0.002%   (was timeout/2.06%)
  /design                              0.001%   (was 4.574%)
  /tech-talks/document-block-types     0.000%   (was 0.940%)
  /tech-talks/ssr-performance-…plan    0.000%   (was 1.962%)
  /notes/datoms-and-rdf                0.001%   (was 1.239%)
  /notes/knowledge-base-sketches…      0.000%   (was 2.558%)
  /tech-talks/improving-editor-…       0.000%   (was 2.058%)
  /tech-talks/system-components        0.000%   (was 1.792%)
  /tech-talks/performance              0.000%   (was 1.639%)
  Widths 900/768 spot-checked ≤0.1%.

Late fixes beyond the session-1 log:
- Content-view embeds: ssr-embed-renderer.ts registry (cycle-safe); ssr-render
  registers a depth-capped recursive renderer; EmbedEditorView uses it when
  typeof window === 'undefined'.
- Empty media captions: NodeViewContent slot filled with contentDOM-style
  inner div + ProseMirror-trailingBreak when empty (but never clobber slots
  the component pre-filled, e.g. code blocks).
- Card fallback images: wave3 also prefetches queryResource for query results
  lacking cover/icon (matches DocumentCard's lazy client fetch → same cards,
  and the client skips the fetch).
- editorWidth passed from loader (contentWidth S600/M700/L900 − 32) into the
  editor stub's domElement so px-width media size identically.
- interaction summaries prefetched for query results (cap 30), home directory
  children, and embed refs (comment-count chips).
- ui/layout.tsx +44px gtSm wrapper bonus → CSS var --doc-gtsm-bonus (hm-prose
  css, min-width 861px) for sidebar-less layouts; JS for sidebar'd ones.

Verification: editor suite 301 passed / 1 pre-existing failure
(readonly-viewer-gallery — fails on clean main too). New ssr-render.test.tsx:
8 tests. tsc clean: editor, ui, shared, web. Prettier applied.

NET CODE: modified files +274 −997; new production modules +529
(ssr-render.tsx 461, query-block-input 33, ssr-embed-renderer 20,
editor-styles 15) → NET −194 production lines, while covering ALL block
types (old string renderer faked a subset). Plus +209 test lines and the
committed parity harness (apps/web/scripts/ssr-parity-check.mjs).

Known limitations (documented, not regressions):
- web-embed (tweets): 3rd-party script content is inherently client-only.
- math: katex renders in an effect; SSR emits the container (no math pages on
  this site; candidate follow-up: katex.renderToString branch).
- table colgroup widths: applied only by the client TableView (no tables here).
- Mobile <768px: pre-existing JS-driven layout swap (useMedia isMobile).
- config.json still points at seedteamtalks (per Eric's request); previous uid
  parked as ERIC_registeredAccountUid.

## Post-swap content flash fix (2026-07-08, session 2)

Reported: things "jump around when loading" (e.g. perceived title font-size
change). Detection required a TEMPORAL tool, not SSR-vs-settled comparison:
a Playwright sampler (CPU-throttled 4x) polling element counts + computed
styles every 25-50ms through the load.

Finding: DOM element count traced 845 → 235 → 877. For ~100-300ms after the
editor mounted over the SSR placeholder, the query block rendered EMPTY:
LazyViewportMount initializes hasMountedOnce=false on the client and waits
for an IntersectionObserver callback, so content the SSR HTML already showed
vanished for a beat and the whole page reflowed (scroll height collapse —
easily perceived as text resizing).

Fix (packages/ui/src/lazy-viewport-mount.tsx): synchronous near-viewport
check in useIsomorphicLayoutEffect — layout-effect state updates flush
before paint, so in-viewport content mounts with zero blank frames; the
IntersectionObserver still lazy-mounts genuinely below-viewport blocks.

Verified: element-count trace now 844 → 877 (no dip); gap-aware large-text
sampler reports zero style/presence changes during load on / and /notes;
title stable at 48px from first sample at 1280/1130/1024 widths; parity
sweep unchanged (0.000-0.021%); ui tsc + editor tests green.
