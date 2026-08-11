# Explore Search Prototype

> Superseded by `docs/projects/explore-advanced-search.md`, which redirects Explore at replacing the Query Documents
> omnibar entry and adopts the wireframe design. Kept for the background on the existing result surfaces and APIs.

## Problem

Seed needs a first useful Explore/search experience inside the existing desktop and web apps, not in the separate
`frontend/apps/explore` project.

The product already has several result-like surfaces:

- omnibar search
- web search
- all-documents pages
- subdocuments/directory pages
- library views
- query blocks / document lists
- the desktop Query Documents playground added on latest `main`

These surfaces overlap conceptually but do not yet share a durable result model or URL-serializable search/query state.
This creates several product and implementation problems:

- Search results are hard to share as a stable URL.
- A search results page cannot easily become a query block.
- A query block or document-list view cannot easily become an Explore URL.
- All-documents, subdocuments, library, query documents, and search results are difficult to transition between.
- Different UIs render similar “results” using different assumptions.
- Users cannot clearly see where the search is being performed: site context or full node context.
- The app does not clearly distinguish document metadata/attribute matches from block/body-content matches and comment
  matches.
- Searching data by attributes at arbitrary depth is important for the full Explore vision, but the current product does
  not expose this as a unified user-facing search experience.

Latest `main` reduces one important backend gap: there is now a document query API for current visible document
attributes. Explore should use that API instead of relying only on frontend-side metadata filtering.

The remaining gap is that there is still no single backend Explore API that returns documents, blocks, and comments as
one typed result stream with unified ranking, matched fields, snippets, facets, pagination, and context metadata.

Therefore, the first prototype should be a frontend-orchestrated Explore experience:

- Use the new `QueryDocuments` API for document/attribute results.
- Use the existing `SearchEntities` API for text, block/body, and comment results.
- Normalize both APIs into shared Explore result types.
- Keep the path open for a future backend Explore API.

## Solution

Build a frontend Explore prototype in the existing desktop and web apps.

Do **not** implement this in `frontend/apps/explore`.

Support only these contexts in v1:

1. **Site context**

   - Available on desktop and web.
   - Searches/queries within the selected site/space.
   - Useful for rendering Explore inside a specific published/shared site.

2. **Node context**
   - Available on desktop only.
   - Searches/queries across all locally visible documents.
   - Useful as a global desktop Explore page.

Do **not** implement document-context Explore in v1. Document context can be revisited after the site/node prototype
proves the model.

### Goals

- Create a shareable Explore URL that restores context, search text, filters, and sort state.
- Introduce shared Explore result types that can represent documents, blocks, and comments.
- Use the new document query API for attribute/document queries.
- Use the current search API for title/body/block/comment text matches.
- Make search context explicit with a Discord-like filter/search UI.
- Create a bridge toward unifying search results, query blocks, all-documents, subdocuments, library, and Query
  Documents over time.

### User stories

#### Site search

As a user viewing a site, I want to open Explore and search only within that site, so results are relevant to the
current space.

Acceptance criteria:

- Web Explore is always site-scoped.
- Desktop Explore can be site-scoped when launched from a site/document context.
- The UI clearly shows the current site context as a visible pill/filter.
- The URL can be copied and reopened to restore the same site search.

#### Node search

As a desktop user, I want a full-node Explore page, so I can search across all local documents.

Acceptance criteria:

- Desktop supports node-scoped Explore.
- Web does not support node-scoped Explore.
- If a node-scoped query somehow appears on web, web normalizes/ignores it and remains site-scoped.

#### Result type filtering

As a user, I want to filter results by Documents, Blocks, and Comments, so I can quickly narrow what kind of match I am
looking for.

Acceptance criteria:

- Explore has tabs or filters for:
  - All
  - Documents
  - Blocks
  - Comments
- Counts are shown when easily available from normalized frontend data.
- Filtering does not require a backend API change.

#### Block result opening

As a user, I want a block match to open the exact document/block location when possible.

Acceptance criteria:

- Block results are represented by `UnpackedHypermediaId`.
- `blockRef` is preserved.
- `blockRange` is preserved when available.
- Opening a block result uses existing packed HM URL behavior.

#### Comment result opening

As a user, I want comment matches to open the relevant document/comment thread.

Acceptance criteria:

- Comment results preserve:
  - containing document ID
  - `commentId`
- Opening a comment result uses the existing document comment route behavior.

#### Attribute search

As a user, I want to search/filter by document metadata and attributes, so Explore can find structured information, not
only text content.

Acceptance criteria:

- V1 compiles supported attribute filters into `QueryDocuments` requests.
- Deep/nested attributes use dot notation.
- The UI can show matched attribute fields for document results when available.
- Attribute name/value autocomplete uses the new autocomplete APIs.
- Backend attribute search is used for document results instead of being only frontend-local filtering.

### Current main-branch API findings

Latest `main` includes a new document attribute query API:

```proto
rpc QueryDocuments(QueryDocumentsRequest) returns (QueryDocumentsResponse);
rpc ListDocumentAttributeNames(ListDocumentAttributeNamesRequest) returns (ListDocumentAttributeNamesResponse);
rpc ListDocumentAttributeValues(ListDocumentAttributeValuesRequest) returns (ListDocumentAttributeValuesResponse);
```

`QueryDocuments` supports:

- recursive filters:
  - `and`
  - `or`
  - `not`
- attribute comparisons:
  - `=`
  - `!=`
  - `<`
  - `<=`
  - `>`
  - `>=`
- attribute presence:
  - exists
  - missing
- string matching:
  - contains
  - prefix
  - case-sensitive or case-insensitive
- built-in location filters:
  - URL match
  - space match
  - path match
- typed values:
  - null
  - string
  - int
  - bool
- attribute sorting
- pagination

Latest `main` also added a desktop Query Documents page:

```txt
frontend/apps/desktop/src/pages/query-documents.tsx
```

That page is a useful reference for:

- condition rows
- attribute name autocomplete
- attribute value autocomplete
- selected-space quick scope
- request preview
- document result rendering
- pagination

Latest `main` also expanded `SearchEntities` with:

- `page_token`
- `next_page_token`
- `entity_kind_filter`

Explore should account for these newer APIs and avoid re-implementing document attribute querying locally.

### Explore result model

Create shared Explore result types with exactly these public variants:

```ts
type HMExploreResult = HMExploreResultDocument | HMExploreResultBlock | HMExploreResultComment
```

```ts
type HMExploreResultDocument = {
  type: 'document'
  id: UnpackedHypermediaId
  document?: HMDocumentInfo
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}

type HMExploreResultBlock = {
  type: 'block'
  id: UnpackedHypermediaId
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}

type HMExploreResultComment = {
  type: 'comment'
  documentId: UnpackedHypermediaId
  commentId: string
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}

type HMExploreMatchedField = {
  kind: 'title' | 'body' | 'comment' | 'attribute' | 'path'
  label: string
  value: string
  attributePath?: string[]
}
```

Result meaning:

- A **document result** means the document itself matched:
  - title/path
  - metadata/attributes
  - document-level query result
- A **block result** means body/block content matched.
- A **comment result** means comment content matched.

Rules:

- `HMExploreResultBlock.id` is the canonical block target.
- The block target is encoded as `UnpackedHypermediaId`.
- `blockRef` must be preserved.
- `blockRange` must be preserved when present.
- Do not require a canonical `excerpt` field for block results.
- Optional `matchText` can carry display/snippet text from the current Search API.
- Exclude contact results from Explore v1.
- Do not add a media result type in v1.

### Query and URL model

Use a GitHub/X-style query string model.

Canonical state:

```txt
?q=<terms and qualifiers>
?sort=<optional sort>
```

Examples:

```txt
?q=roadmap
?q="search API"
?q=roadmap type:block
?q=status:active type:document
?q=has:status priority:"High Risk"
?q=project.phase:research
?q=protocol migration type:comment
?q=in:site roadmap
?q=in:node roadmap
```

Supported v1 grammar:

```txt
free text
"quoted phrase"
type:document
type:block
type:comment
has:<attribute.path>
missing:<attribute.path>
<attribute.path>:<value>
<attribute.path>="<value>"
<attribute.path>!="<value>"
<attribute.path><number
<attribute.path><=number
<attribute.path>>number
<attribute.path>>=number
in:site
in:node
```

Important decision:

- The URL/search-box grammar exposes a simple subset first.
- Internally, the parser compiles supported attribute qualifiers into `DocumentFilter`.
- Do not expose full `OR`, `NOT`, and grouped expressions in the first search-box syntax, even though the backend API
  supports them.
- Advanced boolean composition can be added later through either a query-builder mode or a more complete query language.

V1 query behavior:

- Free text goes to `SearchEntities`.
- Attribute qualifiers go to `QueryDocuments`.
- `type:document` includes document results from both:
  - `QueryDocuments`
  - document/title results from `SearchEntities`
- `type:block` includes block/body results from `SearchEntities`.
- `type:comment` includes comment results from `SearchEntities`.
- `in:site` and `in:node` are query hints; route context is authoritative.
- Web never allows node scope.

Do not support in v1 search-box syntax:

- `OR`
- `NOT`
- parentheses
- regex
- arbitrary backend JSON/proto filter syntax

### Explore context model

Use an explicit context model:

```ts
type HMExploreContext =
  | {
      type: 'site'
      id: UnpackedHypermediaId
    }
  | {
      type: 'node'
    }
```

Rules:

- Site context is available on desktop and web.
- Node context is desktop-only.
- Web Explore always resolves to site context.
- Document context is excluded from v1.

### Backend calls per context

#### Site context

Use both APIs.

For document/attribute results:

- Call `grpcClient.documents.queryDocuments`.
- Scope with the best available location filter:
  - Prefer `urlMatch` with `prefix: true` when the selected site/root has a concrete `hm://...` URL.
  - Use `spaceMatch` when the context is a whole space/account.
  - Use `pathMatch` only when matching a path across accounts is intentionally desired.
- Compile attribute qualifiers into `DocumentFilter`.
- Apply `DocumentSort` for attribute sorts where supported.

For text/block/comment results:

- Call `useSearch` / `SearchEntities`.
- Scope with `iriFilter`, for example:

```txt
hm://<siteUid>*
```

or a more precise subtree glob when the selected site context has a path.

Use `contentTypeFilter` and/or `entityKindFilter` to reduce irrelevant results where possible.

#### Desktop node context

For document/attribute results:

- Call `QueryDocuments` without a site URL/space filter.
- This queries all current visible documents according to backend visibility rules.

For text/block/comment results:

- Call `SearchEntities` without a site `iriFilter`, or with the existing all-node equivalent.
- Use pagination via `pageToken` / `nextPageToken`.

### Search API result mapping

Adapt current `SearchResultItem` into Explore results.

```ts
function searchResultItemToExploreResult(item: SearchResultItem): HMExploreResult | null {
  if (item.type === 'contact') {
    return null
  }

  if (item.type === 'comment' && item.commentId) {
    return {
      type: 'comment',
      documentId: item.id,
      commentId: item.commentId,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  }

  if (item.type === 'document' && item.id.blockRef) {
    return {
      type: 'block',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  }

  if (item.type === 'document') {
    return {
      type: 'document',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  }

  return null
}
```

### QueryDocuments result mapping

Adapt `QueryDocumentsResponse.documents` into document Explore results.

```ts
function documentInfoToExploreResultDocument(
  document: HMDocumentInfo,
  matchedFields?: HMExploreMatchedField[],
): HMExploreResultDocument {
  return {
    type: 'document',
    id: hmId(document.account, {path: document.path}),
    document,
    matchedFields,
  }
}
```

Use existing document-info preparation utilities where possible so Explore rows stay consistent with existing
document-list UI.

### Shared Explore resolver

Create a shared hook/model that orchestrates both APIs.

Suggested shape:

```ts
type UseExploreResultsInput = {
  context: HMExploreContext
  q: string
  sort?: ExploreSort
  limit?: number
}

type UseExploreResultsResult = {
  results: HMExploreResult[]
  counts: {
    all: number
    documents: number
    blocks: number
    comments: number
  }
  isLoading: boolean
  error?: unknown
  loadMore?: () => void
  hasMore?: boolean
}
```

Resolver behavior:

- Parse `q` into:
  - free text terms
  - type filters
  - attribute filters
  - context hint
  - sort hint if present
- Build a `QueryDocumentsRequest` for document/attribute results.
- Build a `SearchEntitiesRequest` for text/block/comment results.
- Run both requests when needed.
- Normalize both responses to `HMExploreResult`.
- Deduplicate document results when the same document appears from both APIs.
- Preserve block and comment results separately.
- Apply result type tabs/filters after normalization.
- Use backend pagination where possible:
  - `QueryDocumentsResponse.nextPageToken`
  - `SearchEntitiesResponse.nextPageToken`

### Attribute query compilation

Compile supported URL/search qualifiers into `DocumentFilter`.

Examples:

```txt
status:active
```

Compiles to string match or equality against key `status`.

```txt
has:status
```

Compiles to exists.

```txt
missing:status
```

Compiles to missing.

```txt
project.phase:research
```

Uses key `project.phase`.

```txt
priority!="low"
```

Compiles to comparison `NOT_EQUAL`.

```txt
estimate>=3
```

Compiles to int comparison when numeric parsing is unambiguous.

V1 defaults:

- Plain `key:value` should use case-insensitive string matching for user-friendliness unless the parser identifies a
  typed value.
- Explicit comparison operators should compile to `DocumentFilter.Comparison`.
- `has:*` and `missing:*` compile to presence filters.
- Multiple attribute filters combine with AND.
- Do not expose OR/NOT in the first search box syntax.

### Attribute autocomplete

Use the new APIs:

```ts
grpcClient.documents.listDocumentAttributeNames
grpcClient.documents.listDocumentAttributeValues
```

Explore should reuse concepts from `QueryDocumentsPage`:

- recursive attribute name lookup for global query building
- account/space-prioritized suggestions where context is site-scoped
- typed value suggestions for string/int/bool where available

UI can start with simple autocomplete in the search box or filter builder. It does not need to duplicate the full Query
Documents playground UI.

### Route model

Add Explore to the existing route system.

Suggested desktop route:

```ts
type ExploreRoute = {
  key: 'explore'
  context:
    | {
        type: 'site'
        id: UnpackedHypermediaId
      }
    | {
        type: 'node'
      }
  q?: string
  sort?: 'relevance' | 'recently_updated' | 'newest' | 'oldest' | 'title'
}
```

Web behavior:

- Web Explore is always site-scoped.
- Supported URL shape should follow existing route conventions, for example:

```txt
/hm/<siteUid>/:explore?q=roadmap
```

- If `in:node` appears on web, ignore/normalize it and keep site scope.

Desktop behavior:

- From a site/document route, “View all results in Explore” opens site-scoped Explore.
- From global desktop/library context, Explore opens node-scoped.
- The existing `query-documents` route remains as a developer/power-user playground unless product decides otherwise.
- Explore should not be implemented by simply renaming the current Query Documents page because Explore also needs block
  and comment search results.

### UI behavior

Create shared Explore UI components.

Required UI pieces:

- page shell
- search input
- context pill:
  - `Site: <name>`
  - `Node`
- active query/filter pills
- result type tabs:
  - All
  - Documents
  - Blocks
  - Comments
- result list
- loading state
- empty state
- error state
- load-more state
- optional sort selector

Suggested layout:

```txt
Explore

[ Site: Product Docs ] [ Search roadmap type:block status:active ]

[ All 24 ] [ Documents 10 ] [ Blocks 11 ] [ Comments 3 ]

-----------------------------------------------------------
[Document] Roadmap
           /Product/Planning
           status: Active

[Block]    Product Roadmap
           /Product/Planning
           ...matching text from SearchEntities if available...

[Comment]  Product Roadmap
           /Product/Planning
           ...matching comment text...
-----------------------------------------------------------
```

Result opening:

- Document:
  - open document route
- Block:
  - pack `HMExploreResultBlock.id`
  - preserve `blockRef` and `blockRange`
- Comment:
  - open containing document route with `openComment: commentId`

### Query Documents page relationship

The new `frontend/apps/desktop/src/pages/query-documents.tsx` should influence Explore but not define the final Explore
UX.

Use it as reference for:

- constructing `DocumentFilter`
- constructing `DocumentSort`
- attribute autocomplete
- value autocomplete
- rendering document query results
- pagination

Do not blindly copy its full UI into Explore.

Explore should be a search/results page for normal users, while Query Documents can remain a lower-level document-query
playground.

Potential shared extraction after rebase:

- condition/filter-to-`DocumentFilter` helpers
- attribute autocomplete adapter
- attribute value formatter
- document query result mapper

Keep extraction minimal for the prototype.

### Shared conversion bridge

Add shared utilities so Explore can become the bridge between search, query blocks, all-documents, subdocuments,
library, and Query Documents.

Suggested utilities:

```ts
searchResultItemToExploreResult(item): HMExploreResult | null

documentInfoToExploreResultDocument(
  document: HMDocumentInfo,
  matchedFields?: HMExploreMatchedField[],
): HMExploreResultDocument

exploreResultDocumentToDocumentInfo(
  result: HMExploreResultDocument,
): HMDocumentInfo | null

parseExploreQuery(q): ParsedExploreQuery

serializeExploreQuery(parsed): string

exploreQueryToDocumentFilter(parsed): DocumentFilter | null

documentFilterToExploreQuery(filter): string | null

exploreQueryToHMQuery(parsed): HMQuery | null

hmQueryToExploreQuery(query): string
```

V1 conversion rules:

- Query blocks are document-list oriented.
- Explore includes documents, blocks, and comments.
- Explore → query block should preserve only document-compatible filters.
- Block/comment filters should not become query blocks in v1.
- QueryDocuments filters can map more directly to Explore document filters than before.
- Unsupported query-block or `DocumentFilter` features should not be silently misrepresented.

### Desktop integration requirements

Add a desktop Explore page.

Expected areas:

- desktop route switch
- desktop Explore page wrapper
- shared route serialization
- omnibar integration
- SearchEntities integration
- QueryDocuments integration

Desktop acceptance criteria:

- Node Explore works.
- Site Explore works.
- Attribute document queries use `QueryDocuments`.
- Text/block/comment results use `SearchEntities`.
- Existing desktop search input still works.
- Existing Query Documents page still works.
- Existing document/comment opening behavior still works.

### Web integration requirements

Add a web Explore page.

Expected areas:

- web catchall route parsing
- web route rendering/provider
- shared Explore UI
- site-only context resolution

Web acceptance criteria:

- Site Explore page loads.
- Results are site-scoped.
- Attribute document queries use `QueryDocuments`.
- Text/block/comment results use `SearchEntities`.
- URL restores query/filter/sort state.
- Node context is not exposed.

### Future full Explore direction

The prototype should leave a clear path toward a real backend-supported Explore API.

A future backend Explore/Search API should ideally return first-class typed results:

```ts
type BackendExploreResult = BackendExploreDocumentResult | BackendExploreBlockResult | BackendExploreCommentResult
```

Future backend result data should include:

- result kind
- canonical target ID
- containing document ID where relevant
- block ID/range where relevant
- comment ID where relevant
- matched fields
- matched attribute paths
- snippets/excerpts generated consistently
- score/ranking
- updated/version time
- context information
- pagination cursor
- facets/counts

Future backend query support should include:

- site scope
- node scope
- document scope
- child-document inclusion
- attributes at arbitrary depth
- typed attribute values
- server-side sorting
- server-side facets
- pagination
- stable query serialization

Future app unification should move toward:

- Explore as the generic result-view model.
- Query blocks as a document-result specialization.
- All-documents as a predefined Explore/query view.
- Subdocuments as a scoped Explore/query view.
- Library as a node-scoped Explore/query view.
- Query Documents as an advanced document-filter/query builder that can serialize into Explore when compatible.
- Shared URL serialization for all of the above.

## Scope

### In scope for v1 prototype

- Main desktop Explore page.
- Main web Explore page.
- Site-scoped Explore.
- Desktop-only node-scoped Explore.
- Shared result model:
  - `HMExploreResultDocument`
  - `HMExploreResultBlock`
  - `HMExploreResultComment`
- Adapter from `SearchResultItem`.
- Adapter from `QueryDocumentsResponse.documents`.
- Query parser/serializer.
- Compilation of supported attribute qualifiers into `DocumentFilter`.
- Attribute autocomplete using `ListDocumentAttributeNames`.
- Attribute value autocomplete using `ListDocumentAttributeValues`.
- Shared result rendering UI.
- URL serialization/restoration.
- Basic pagination/load-more.
- “View all results in Explore” path from current search UI where straightforward.
- Project documentation explaining prototype and future full Explore direction.

### Out of scope for v1 prototype

- Separate `frontend/apps/explore` implementation.
- New backend Explore API.
- Proto changes beyond what already exists on latest `main`.
- Document-context Explore.
- Full result-view unification across the app.
- Full boolean query language in the search box.
- Media result type.
- Backend ranking changes.
- Backend facets.
- Perfect cross-stream relevance ranking between `QueryDocuments` and `SearchEntities`.

### Suggested phases

#### Phase 1: Rebase and project document

- Rebase branch onto latest `origin/main`.
- Confirm new QueryDocuments files/types are present.
- Create/update `docs/projects/explore-search-prototype.md`.

#### Phase 2: Shared model and query parser

- Add Explore result types.
- Add `SearchResultItem` adapter.
- Add `QueryDocuments` adapter.
- Add parser/serializer for v1 `q`.
- Add `DocumentFilter` compiler for supported attribute syntax.
- Add unit tests.

#### Phase 3: Shared resolver

- Build `useExploreResults`.
- Orchestrate `QueryDocuments` and `SearchEntities`.
- Support site and desktop node context.
- Support pagination/load more.
- Deduplicate document results.
- Add tests for resolver behavior where practical.

#### Phase 4: Shared UI

- Build Explore shell.
- Build context pills.
- Build query/filter pills.
- Build result type tabs.
- Build document/block/comment rows.
- Build loading/empty/error/load-more states.

#### Phase 5: Desktop integration

- Add desktop Explore route/page.
- Add node context.
- Add site context.
- Add omnibar “View all results in Explore”.
- Preserve existing Query Documents page.

#### Phase 6: Web integration

- Add web Explore route/page.
- Enforce site-only context.
- Ensure URL restore works.
- Ensure node context is ignored/normalized.

#### Phase 7: Future direction write-up

Document remaining API/product direction:

- unified backend Explore API
- typed backend result variants
- backend matched fields/snippets
- backend facets/counts
- unified result/query model across query blocks, all-documents, subdocuments, library, and Explore

### Test plan

#### Rebase validation

After rebase:

```bash
git status --short --branch
git log --oneline --decorate -10
```

Confirm latest `origin/main` includes:

- `QueryDocuments`
- `ListDocumentAttributeNames`
- `ListDocumentAttributeValues`
- `query-documents` desktop route/page
- `SearchEntities.pageToken`
- `SearchEntities.entityKindFilter`

#### Adapter tests

Test:

- `SearchResultItem` document without `blockRef` → `HMExploreResultDocument`
- `SearchResultItem` document with `blockRef` → `HMExploreResultBlock`
- block result preserves `blockRange`
- comment result with `commentId` → `HMExploreResultComment`
- contact result → `null`
- `QueryDocuments` document → `HMExploreResultDocument`
- matched attribute fields render as `HMExploreMatchedField`

#### Query parser tests

Test:

```txt
roadmap
"search API"
roadmap type:block
type:document status:active
has:status
missing:status
project.phase:research
priority:"High Risk"
estimate>=3
in:site roadmap
in:node roadmap
```

Expected:

- free text extracted
- quoted phrases preserved
- type filters recognized
- attribute filters recognized
- numeric comparisons recognized where unambiguous
- context hints recognized
- unsupported syntax does not crash

#### DocumentFilter compiler tests

Test:

- `status:active` compiles to a string attribute filter
- `has:status` compiles to exists
- `missing:status` compiles to missing
- `project.phase:research` preserves nested key
- `estimate>=3` compiles to int comparison
- multiple attribute filters combine with AND
- site context adds URL/space scope filter
- node context does not add site scope

#### Route tests

Test:

- desktop site Explore URL roundtrip
- desktop node Explore URL roundtrip
- web site Explore URL roundtrip
- web does not generate node Explore
- web ignores/normalizes `in:node`
- existing route terms still parse

#### UI tests

Test:

- context pill renders
- type tabs render
- document/block/comment rows render
- tabs filter result kinds
- attribute matched fields render
- empty/loading/error states render
- block click preserves packed block ID
- comment click opens document comment route

#### Manual smoke tests

Desktop:

1. Open desktop app.
2. Open node Explore.
3. Search a known body term.
4. Confirm block results appear.
5. Click a block result.
6. Confirm document opens with block target preserved.
7. Search a known comment term.
8. Confirm comment result opens the document/comment.
9. Search an attribute query like `status:active`.
10. Confirm document results come from attribute query.
11. Open Explore from a site/document context.
12. Confirm context pill shows site scope.

Web:

1. Open a site.
2. Open Explore.
3. Search text.
4. Confirm results are site-scoped.
5. Search an attribute query.
6. Confirm document results are site-scoped.
7. Copy URL and reload.
8. Confirm query/context restore.
9. Try `in:node`.
10. Confirm web remains site-scoped.

### Verification commands

Run relevant frontend checks after implementation:

```bash
direnv exec . pnpm --filter @shm/shared test
direnv exec . pnpm --filter @shm/shared typecheck
direnv exec . pnpm --filter @shm/ui test
direnv exec . pnpm --filter @shm/ui typecheck
direnv exec . pnpm --filter @shm/web test
direnv exec . pnpm --filter @shm/web typecheck
direnv exec . pnpm --filter @shm/desktop test
direnv exec . pnpm --filter @shm/desktop typecheck
direnv exec . pnpm -r format:check
```

If the change is broad, also run frontend Agent CI:

```bash
direnv exec . npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token
```

## Rabbit Holes

Avoid these for the prototype:

- Replacing the new Query Documents page.
- Building a full visual query builder inside Explore.
- Exposing backend `OR`/`NOT`/nested filters in the first search syntax.
- Creating a new backend Explore API immediately.
- Changing protobuf schemas again.
- Refactoring every result-like page into Explore.
- Replacing query blocks.
- Replacing library/all-documents/subdocuments.
- Implementing document-context Explore.
- Adding media results.
- Building perfect snippets.
- Solving cross-stream ranking between QueryDocuments and SearchEntities.
- Adding backend facets/counts.
- Designing a complete query language.

## No Gos

- Do not implement this in `frontend/apps/explore`.
- Do not require new backend changes for v1 beyond what already exists on latest `main`.
- Do not require new proto changes for v1.
- Do not ignore the new `QueryDocuments` API; use it for document/attribute results.
- Do not expose node-scoped Explore on web.
- Do not implement document-context Explore in v1.
- Do not rename result types away from:
  - `HMExploreResultDocument`
  - `HMExploreResultBlock`
  - `HMExploreResultComment`
- Do not add `HMExploreResultMedia` in v1.
- Do not require `excerpt` as canonical block-result data.
- Do not lose `blockRef`.
- Do not lose `blockRange`.
- Do not silently convert block/comment filters into query blocks.
- Do not break existing omnibar search.
- Do not break existing web search.
- Do not break the new Query Documents page.
- Do not claim full backend Explore support exists; v1 is still a frontend orchestration layer over two APIs.
