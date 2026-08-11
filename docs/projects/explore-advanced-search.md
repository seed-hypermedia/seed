# Explore: Advanced Search

Supersedes `docs/projects/explore-search-prototype.md`. Design reference: `docs/seed-explore-prd.md` (browse/search
states) and the two wireframes provided by Horacio (filter bar + chips + tabs header, and the result-item treatment with
match highlighting and grouped block matches).

## Problem

Two half-finished surfaces cover the same need and neither is usable:

- **Query Documents** (`frontend/apps/desktop/src/pages/query-documents.tsx`) is the only way to run a real attribute
  query — conditions with `and`/`or`, compare/contains/starts-with/exists/missing, typed values, attribute-name and
  attribute-value autocomplete, `$space`/`$path` built-ins, multi-key sort, `Load more`, a request preview. It is a
  debug console: no free-text search, no result types other than documents, nothing shareable, and its UI does not
  belong in the product.
- **Explore** (branch `explore-search-gap-analysis`) has the right shape — shared result model, query grammar, type
  tabs, URL state, desktop + web integration — but the search itself does not work. The desktop page runs
  `queryDocuments` with no free-text predicate and appends every document in scope regardless of what was typed; the web
  page never calls `queryDocuments` at all, so `status:active` returns nothing and spins forever; `sort` rewrites the
  URL without reordering anything; each keystroke on web pushes a history entry; there is no pagination past the first
  50 results; `matchedFields` is never populated; results are not deduplicated across the two sources. The visual design
  is a placeholder.

Meanwhile a user cannot answer basic questions: _which documents in this site have `status = In Progress`_, _where does
"Engelbart" appear anywhere in my node_, _show everything in Alice's and Bob's spaces tagged `type: task`_ — and cannot
share the answer with anyone, because the query is not in the URL.

## Solution

One Explore surface, reachable from the omnibar (the entry currently labelled _Query Documents_ becomes **Advanced
search** and opens Explore), scoped to the whole node (desktop) or a single site (desktop and web). It carries over all
of Query Documents' expressive power behind the wireframe's UI, and adds free-text search, non-document result types,
match highlighting and a table view. Query Documents stays reachable at its route as a fallback; only the omnibar link
moves.

### Query state: one string

The entire query — free text, conditions, boolean structure, presentation — lives in a single `q=` parameter, so any
view is a link. Desktop route `{key: 'explore', context, q}`; web `…/<path>:explore?q=…`. The legacy `sort=` param is
read once and folded into `q` for backwards compatibility, then dropped.

Grammar (parsed to an AST; the AST is the single source of truth for both the chips bar and the builder):

- free words and `"quoted phrases"` → full-text terms
- `key:value`, `key="two words"`, `key!=value`, `key>=3`, `key<10` → attribute comparison, typed (string/int/bool)
- `key~value` contains, `key^value` starts with, `has:key`, `missing:key`
- `in:<space-uid|hm:// url>` (repeatable), `path:/specs`, `path:/specs/*` (subtree) → the `$space`/`$path` built-ins
- `type:document|block|comment`
- `AND`, `OR`, `NOT`, parentheses; adjacency means `AND`:
  `(in:alice OR in:bob) AND type:task status="In Progress" Engelbart`
- presentation directives, hidden from the chips bar and driven by the view controls instead: `view:table`,
  `cols:title,status,updated`, `sort:status,-priority`

Serialization is stable and round-trips: builder edit → AST → `q` → parse → identical AST. Navigation on typing replaces
the history entry (debounced); only explicit submits/chip edits push.

### Result engine (shared by desktop and web)

A single hook in `@shm/shared` owns all fetching, so both apps behave identically and neither re-implements the other's
half:

- **Documents** come from `QueryDocuments` with the AST's attribute/space/path conditions compiled into a nested
  `DocumentFilter` (`and`/`or`/`not` map straight onto the proto's recursive filter), `sort` from the `sort:` directive,
  paged with `nextPageToken`.
- **Free text** comes from `SearchEntities` (`contentTypeFilter` per active type, `contextSize` for snippets,
  `iriFilter` from the scope) and yields document, block and comment hits.
- **Both present** → intersect: text hits are kept only when their target document is in the document-query result set
  (auto-paged up to a cap; a notice appears when the cap truncates the intersection). Free text alone → search results
  only. Conditions alone → document results only. This is what fixes today's "every document in the site matches"
  behaviour.
- Results are deduplicated by a stable key, generation-guarded so stale responses cannot overwrite fresh ones, and each
  stream keeps its own `Load more`.
- Block hits are grouped under their parent document (`N matching blocks`, each with a _Jump to source_ link preserving
  `blockRef`/`blockRange`); comment hits open the comment.

### UI (per wireframe)

- Scope pill + full-width search input with the raw `q` text.
- Filter bar of dropdowns (`Type`, `In`, `Attributes`) with active counts, and a chips row below: one removable chip per
  condition, plus `Clear all`. Chips are rendered from the AST, so a hand-typed query immediately shows as chips.
- **Advanced** panel: the nested condition-group builder — the primary way to build complex queries. Groups with
  `All`/`Any`/`Not`, condition rows with attribute-name autocomplete (`ListDocumentAttributeNames`), value autocomplete
  (`ListDocumentAttributeValues`), kind/operator/value-type selects, `$space` (site list) and `$path` built-ins. Query
  Documents' condition semantics move here rather than being reinvented. The JSON request preview survives as a
  collapsed developer section.
- Tabs `All / Documents / Text blocks / Conversations` with counts; attribute-only controls (attribute sorts, columns)
  disable with an explanation on the non-document tabs.
- Result header: count, list/table toggle, sort select.
- **List item** treatment from the second wireframe: type label, title with matched terms highlighted, breadcrumb ·
  author · date, snippet with highlighted terms, matched-attribute chips (`status In Progress`) for every attribute the
  query references, grouped block matches. Highlighting is computed client-side from the query terms against
  title/snippet (`SearchEntities` returns a context snippet, not match ranges).
- **Table view**: column picker over built-ins (title, space, path, author, updated, version) plus any attribute,
  click-to-sort headers building the multi-key `sort:` directive, all encoded in `q`.
- Loading, error, empty and end-of-results states for every stream.

### User stories

- As a site member I filter a site to `status="In Progress"` and share the link with my team.
- As a desktop user I search `Engelbart` across my whole node and see the documents, the text blocks that mention it,
  and the conversations about it.
- As a desktop user I scope to two spaces at once — `(in:alice OR in:bob) AND type:task` — and read the result as a
  table with `status` and `priority` columns sorted by priority.
- As a power user I open **Advanced**, build a nested group I could not type from memory, and the search box updates to
  the equivalent query string.

### Acceptance criteria

- Every Query Documents capability is available in Explore's advanced builder (nested and/or/not, all condition kinds,
  typed values, both autocompletes, `$space`/`$path`, multi-key sort, load more).
- Typing free text never returns documents that do not match the text.
- Attribute queries return identical results on desktop and web for the same site scope.
- `q` round-trips through reload and copy/paste, including nested groups, columns and sort.
- Sort and columns visibly reorder/reshape results; pagination continues past 50.
- Blocks open at the matched block; comments open the comment.
- Node scope is offered only on desktop; on web, `in:` targets outside the current site render as unavailable chips.

## Scope

Sequential phases; each is one working session unless noted, and each leaves the branch shippable.

1. **Grammar + AST** — parser, serializer, nested-filter compiler, unit tests. Rewrites the branch's flat
   `parseExploreQuery`. _(1 session)_
2. **Result engine** — shared fetching hook: document stream, search stream, intersection, dedupe, stale guards,
   per-stream pagination. Depends on 1. _(1 session)_
3. **UI shell** — search input, filter dropdowns, chips, tabs with counts, list results with highlighting, grouped block
   matches, matched-attribute chips, all states. Depends on 2. _(1–2 sessions)_
4. **Advanced builder** — nested group editor and both autocompletes, wired to the AST. Depends on 1 and 3. _(1
   session)_
5. **Table view** — column picker, sortable headers, `view:`/`cols:`/`sort:` encoding. Depends on 2 and 3. _(1 session)_
6. **Integration + verification** — omnibar entry relabelled to _Advanced search_ pointing at Explore, web route and
   legacy `sort=` migration, node/site scope rules, typecheck/tests/format, runtime pass on desktop and web with seeded
   content (`.agents/skills/testing-explore-search`). Depends on all. _(1 session)_

## Rabbit Holes

- A backend Explore API, or any proto change, to get author/date filtering, built-in sort keys, or match ranges.
- Fixing the pre-existing bad block→document mapping in the search index: block results already open the wrong document
  from the existing web header search. Track separately; Explore only has to not make it worse.
- Rewriting Query Documents on top of the new engine, or deleting it.
- Saved/named views, view sharing as documents, per-space defaults.
- Virtualized table, resizable/reorderable columns, inline editing of attributes from the table.
- Passing raw FTS5 syntax through the grammar, stemming-accurate highlighting, or ranking tuning (`authority_weight`).
- The PRD's knowledge-graph panel, media results, and the quick-search dropdown redesign.
- Globally interleaving documents, blocks and comments into one relevance-ranked list — the two APIs have incomparable
  scores; the `All` tab groups by type instead.

## No Gos

- No backend, daemon or proto changes. Everything is a client-side workaround.
- No `Author` or `Date` facets, and no relevance/recency/title sorts on the document stream: the daemon can only sort by
  attribute keys, and client-side sorting would be wrong past the first page. Free-text results keep the search API's
  own relevance order.
- No `Media` result type — nothing indexes media as a result today.
- Query Documents is not removed and its route keeps working; only the omnibar entry changes.
- No saved views, no server-side persistence of any Explore state — `q` is the only state.
- No cross-site scope on web: web Explore stays scoped to its own site.
- No changes to the omnibar's existing quick-search results beyond the relabelled entry, and no changes to the existing
  web header search.
- No new dependencies; existing design tokens and `@shm/ui` components only.
