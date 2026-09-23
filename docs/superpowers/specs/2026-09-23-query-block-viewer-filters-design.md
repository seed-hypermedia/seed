# Query Block Viewer Filters Design

## Goal

Make query-block search and filters accurate across the complete source query while keeping them temporary for each viewer. Reuse the Explore filter-chip presentation so filtering looks and behaves consistently across the app.

## Current Problem

`QueryBlockContent` owns search and filter state and applies both to its `items` prop. The Query Block request applies the saved block limit before it returns those items. Search and filters therefore inspect only the limited result set and cannot find matching documents outside it.

The current filter popover also puts attribute, operator, value, and removal controls in one narrow row. Values can collapse to an unusable width, and active conditions disappear when the popover closes.

## Product Behavior

- Search and filters are temporary viewer state. They are not written into the query block or document draft.
- Search and filters apply to every document in the source query, not only the currently shown or progressively rendered documents.
- The evaluation order is source scope, temporary search and filters, sort, saved block limit, and rendering.
- All active filters use AND semantics.
- Empty filter values do not affect results.
- Closing the document or unmounting the query block clears the temporary state.
- Changing search or filters keeps current results visible while the replacement request is in flight and shows a small `Updating results…` status.
- The result summary distinguishes the saved limit from the complete match count, for example `Showing 20 of 47 matches`.

## Shared Filter Presentation

Extract the reusable presentation now embedded in `explore-page.tsx`:

- `FilterChipButton`: a rounded outline trigger with active and open states. This generalizes the current `ExploreChipButton`.
- `ActiveFilterChip`: a rounded chip with a label, an `X`, and an accessible removal label.
- `ActiveFilterChipRow`: a wrapping group of active chips with an optional `Clear all` action.

Explore continues to own its URL query parser and URL-backed filter state. Query blocks use the shared presentation only and keep their own temporary state. Do not couple query blocks to Explore query tokens or routing.

The query-block toolbar has this structure:

```text
[ Filter 2 ▾ ] [ Sort ▾ ] [ Attributes ▾ ]    [ Search all documents… ]

[ Status is Ready × ] [ Priority > 2 × ]  Clear all

Showing 20 of 47 matches
```

The filter popover uses the existing Explore menu surface tokens for border, radius, background, shadow, and spacing. Each condition uses labeled controls. Attribute and condition share the first row; the value uses the full second row. On narrow layouts, all controls stack. `Add another condition` is a secondary action, not a full-width outlined button.

## Temporary Query Input

Extend `HMQueryBlockInput` with an optional viewer-only value:

```ts
viewer?: {
  search?: string
  filters?: Array<{
    columnId: string
    operator: 'contains' | 'equals' | 'greaterThan' | 'lessThan'
    value: string
  }>
}
```

Normalize this state at the UI boundary before requesting data:

- trim search text;
- remove filters with empty values;
- preserve condition order for display;
- omit `viewer` when no temporary condition is active.

Include the normalized input in the React Query cache key. Debounce search text, but apply discrete filter changes immediately. React Query cancellation prevents slower obsolete requests from replacing newer results.

## Query Resolution

The Query Block resolver already follows all `QueryDocuments` pages before applying `query.limit`. Use that complete resolved set as the evaluation boundary:

1. Resolve the saved source scope through `QueryDocuments`.
2. Remove the query target and enforce `Children` or `AllDescendants` mode.
3. Apply temporary search and filters to the complete set.
4. Apply any sort that is not fully handled by `QueryDocuments` to the complete matching set.
5. Record `totalMatches`.
6. Apply the saved query-block limit.
7. Load interaction summaries and account metadata for only the visible results.
8. Return visible results and `totalMatches`.

This first version prioritizes correctness and uses the complete set already loaded by the resolver. It does not add a second search service or combine results from different indexes. Metadata conditions can be pushed into `QueryDocuments` later as a performance optimization, provided behavior remains identical.

## Supported Fields

Only show fields that the resolver can evaluate correctly before the saved limit:

- Name
- Path
- Tags
- Created
- Last Modified
- Subdocuments
- Comments
- primitive custom metadata attributes

Text search checks document name, path, tags, and primitive custom metadata values. It is case-insensitive and uses contains matching.

Do not offer Backlinks or Authors in the temporary filter menu in this version. Backlinks are loaded through a separate client hook, and display author names are loaded only after result selection. Offering either would recreate partial-result behavior. They remain available as table columns. Support can be added later when query resolution has complete indexed values for them.

## Result Payload

Add `totalMatches` to `HMQueryBlockPayload`. It reports the count after temporary search and filters and before the saved block limit. Existing consumers that do not send viewer conditions receive the same visible results as before plus this count.

The UI does not derive this count from the returned array because a saved limit can make that value incomplete.

## States and Accessibility

- **Idle:** normal toolbar and results.
- **Active:** filter trigger uses the shared active style; active chips appear below the main toolbar row.
- **Updating:** retain results, disable duplicate submissions, and announce `Updating results…` in a polite live region.
- **Empty:** show `No documents match the current search and filters.` with a `Clear all` action.
- **Error:** retain the last successful results and show a compact retry message near the result summary.
- **Keyboard:** triggers, menus, fields, chip removal, and Clear all remain reachable in logical order. Each chip removal button names the complete condition.
- **Responsive:** the search input moves to its own row; filter fields stack without horizontal clipping.

## Testing

### Query resolution

- A matching document after the saved limit is returned when a temporary search makes it part of the limited matching set.
- Filters run before the saved limit.
- Search and multiple filters combine correctly.
- Empty temporary values are ignored.
- `totalMatches` is computed before the saved limit.
- Unsupported derived fields are rejected or omitted at the input boundary.
- Query behavior is unchanged when `viewer` is absent.

### React Query integration

- Normalized viewer state is part of the cache key and request input.
- Clearing temporary state restores the base query key and results.
- Obsolete search requests cannot replace newer results.

### UI

- Explore and query blocks render the same shared chip components.
- Active conditions stay visible after the filter popover closes.
- Removing one chip updates the request.
- Clear all removes search and filters.
- The result summary shows visible and total matches correctly.
- The filter editor stacks at narrow widths and does not collapse its value field.
- Loading, empty, error, focus, and keyboard states remain accessible.

## Scope Limits

- Do not persist viewer search or filters in the block, document draft, route, or local storage.
- Do not change the saved query schema.
- Do not add OR groups, nested conditions, saved views, or filter presets.
- Do not add query-wide filtering for Backlinks or Authors until complete resolver data exists.
- Do not redesign Explore filtering beyond extracting shared presentation components.
