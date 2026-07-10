# Onyx examples

Every example here is a schema built *with* Onyx, published under the
`hm://example.com/*` authority (local files are `example-*.json`). Each one
demonstrates a specific feature, links to others, and is checked by
[`validate.mjs`](./validate.mjs) — validated as a well-formed schema, plus
positive and negative **data** cases. Click any name to open it in the explorer.

## Structs & primitives

- [`example-address`](./example-address.json) — a closed struct of three strings.
- [`example-geo`](./example-geo.json) — `float` lat/lng + `integer` altitude.
- [`example-person`](./example-person.json) — strings, an `integer`, a `boolean`, an [`include`](./references.md) of an address, and a list.
- [`example-blob`](./example-blob.json) — a `bytes` payload with a mime string and size.

## Enums

- [`example-status`](./example-status.json) — a `string` restricted to `draft | published | archived` (an `enum` refinement on the string primitive).

## Generics — list & map ([schema-language.md](./schema-language.md))

- [`example-tags`](./example-tags.json) — `List<String>`.
- [`example-matrix`](./example-matrix.json) — `List<List<Integer>>` (nested).
- [`example-metadata`](./example-metadata.json) — `Map<String>` (open map).
- [`example-registry`](./example-registry.json) — `Map<Link<Person>>`.
- [`example-counts`](./example-counts.json) — `Map<Integer>` (the worked example).

## Unions ([schema-language.md](./schema-language.md))

- [`example-value`](./example-value.json) — `anyOf` string / integer / boolean / null.
- [`example-entry`](./example-entry.json) — a filesystem entry: a folder **or** a file.
- [`example-json`](./example-json.json) — the classic **recursive union**: a JSON value is null, bool, number, string, `List<json>`, or `Map<json>`. It references *itself*.

## Recursion ([references.md](./references.md))

Only possible because references are **names**, not content hashes:

- [`example-document`](./example-document.json) — self-reference (`previous` → another document).
- [`example-comment`](./example-comment.json) — a thread: a comment's `replies` are comments.
- [`example-tree`](./example-tree.json) — a node with child nodes.
- [`example-folder`](./example-folder.json) ↔ [`example-file`](./example-file.json) — **mutual** recursion; click folder → file → folder in a circle.

## Extension — subtyping ([schema-language.md](./schema-language.md))

- [`example-employee`](./example-employee.json) — extends [`example-person`](./example-person.json) with `employeeId` + `department`.
- [`example-admin`](./example-admin.json) — extends [`example-employee`](./example-employee.json) (a two-level chain admin → employee → person) with `permissions`.

## Composite

- [`example-article`](./example-article.json) — the centerpiece, pulling it together: a `status` enum, an author `Link<Person>`, `tags` (`List<String>`), a `bytes` body, `wordCount`, a cover `Link<Blob>`, a list of comment links, and open `Map<String>` metadata. Deeply linked to [status](./example-status.json), [tags](./example-tags.json), [person](./example-person.json), [blob](./example-blob.json), [comment](./example-comment.json), and [metadata](./example-metadata.json).

---

To validate any of these against your own data:

```sh
node validate.mjs example-article.json my-article.json
```
