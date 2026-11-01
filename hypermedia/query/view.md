---
name: Query View
summary: The shared default filters of a Query block, published with its containing document.
---

A **query view** stores the default filter conditions of a [query block](hm://hyper.media/block/query) in `attributes.view`. It applies to Card, List and Table styles, not just table presentation. Each condition has a `columnId`, an `operator` (`contains`, `equals`, `notEquals`, `greaterThan` or `lessThan`), and a string `value`. Custom attribute columns use `metadata:<key>`.

Authorized editors change these filters in the normal document draft, just like sort and column settings. **Publish** saves the shared View in signed document content. Filtering never publishes implicitly. Readers start with the published View and can temporarily override it without changing the document. Reader overrides disappear on reload; clearing filters as an editor and publishing saves an empty shared View.

Older documents without a View start unfiltered. This is one default View, not a named-view library. Search text remains temporary. Saved filters are presentation, not an access-control boundary.
