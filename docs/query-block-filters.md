# Query Block Filters

## Problem

Query blocks can choose a directory, traversal mode, sort, and limit, but cannot narrow results by document attributes.
The immediate need is filtering a query block to documents where a given account is one of the document authors. A
similar stored filter model should also support publish-date filtering without redesigning the query shape.

## Solution

Store filters on the query object as `query.filters`, a sibling to `includes`, `sort`, and `limit`:

```ts
{
  includes: [{space, path, mode}],
  sort: [{term: 'UpdateTime', reverse: false}],
  limit: 10,
  filters: [
    {type: 'Author', uid: '<account-id>'},
    {type: 'PublishDate', from: '2024-01-01', to: '2024-12-31'},
  ],
}
```

The shared query resolver fetches the directory, applies filters, then sorts and limits results. Author filters match if
any stored author UID equals the requested UID. Publish-date filters use `metadata.displayPublishTime` when available
and fall back to `updateTime`.

## Scope

- Add `HMQueryFilter` schema/type support for `Author` and `PublishDate` filters.
- Persist filters through query block editor props and HM block conversion.
- Add editor controls for multi-select author account autocomplete by profile name and publish-date range.
- Apply filters in shared query block resolution before sorting and limiting.
- Cover persistence and resolver behavior with tests.

## Rabbit Holes

- Server-side filtering in `ListDirectory` for pagination-scale efficiency.
- Multi-include query semantics.
- Rich account picker/autocomplete for author selection.
- More date modes, such as create time, update time, activity time, or exact publication timestamp source selection.
- Complex boolean logic UI for nested AND/OR groups.

## No Gos

- Do not place filters inside `includes[]`; include entries remain only `{space, path, mode}`.
- Do not add one-off top-level fields like `authorFilter`; use the generic `filters` array.
- Do not store author profile names in filters; store selected account IDs only.
- Do not change backend proto/API in this iteration unless query block pagination requires server-side filtering later.
