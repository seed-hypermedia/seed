---
name: Examples
summary: A catalog of every Onyx example schema — structs, enums, generics, unions, recursion, extension, and live instances.
---

# Onyx examples

Every example here is a schema built *with* Onyx, published under the
`hm://example.com/*` authority (local files are `example-*.json`). Each one
demonstrates a specific feature, links to others, and is checked by
`validate.mjs` — validated as a well-formed schema, plus
positive and negative **data** cases.

## Structs & primitives

- `example-address` — a closed struct of three strings.
- `example-geo` — `float` lat/lng + `integer` altitude.
- `example-person` — strings, an `integer`, a `boolean`, an [include](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references) of an address, and a list.
- `example-blob` — a `bytes` payload with a mime string and size.

## Enums

- `example-status` — a `string` restricted to `draft | published | archived` (an `enum` refinement on the string primitive).

## Generics — list & map ([schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language))

- `example-tags` — `List<String>`.
- `example-matrix` — `List<List<Integer>>` (nested).
- `example-metadata` — `Map<String>` (open map).
- `example-registry` — `Map<Link<Person>>`.
- `example-counts` — `Map<Integer>` (the worked example).

## Unions ([schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language))

- `example-value` — `anyOf` string / integer / boolean / null.
- `example-entry` — a filesystem entry: a folder **or** a file.
- `example-json` — the classic **recursive union**: a JSON value is null, bool, number, string, `List<json>`, or `Map<json>`. It references *itself*.

## Recursion ([references](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references))

Only possible because references are **names**, not content hashes:

- `example-document` — self-reference (`previous` → another document).
- `example-comment` — a thread: a comment's `replies` are comments.
- `example-tree` — a node with child nodes.
- `example-folder` ↔ `example-file` — **mutual** recursion; click folder → file → folder in a circle.

## Extension — subtyping ([schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language))

- `example-employee` — extends `example-person` with `employeeId` + `department`.
- `example-admin` — extends `example-employee` (a two-level chain admin → employee → person) with `permissions`.

## Composite

- `example-article` — the centerpiece, pulling it together: a `status` enum, an author `Link<Person>`, `tags` (`List<String>`), a `bytes` body, `wordCount`, a cover `Link<Blob>`, a list of comment links, and open `Map<String>` metadata. Deeply linked to `example-status`, `example-tags`, `example-person`, `example-blob`, `example-comment`, and `example-metadata`.

## Instances — actual data

An **instance** is a data value typed by a schema: `{ "$type": <schema>, "value": … }`.
Each is validated live against its type, and each page shows **Dependencies**
(its type) and **Dependents**. They form a dependency chain — `bob` → `employee`
→ `person`:

- `example-alice`, `example-carol` — people (instances of `example-person`).
- `example-bob`, `example-dave` — employees (instances of `example-employee`).
- `example-root` — an admin (instance of `example-admin`, which is itself two levels of extension).

Every schema and instance page shows what it **depends on** and what **depends on it** — so from `example-person` you can see its dependents (`example-employee`, plus `alice` and `carol`), and from `bob` you can walk up to `employee` and `person`.

---

To validate any of these against your own data:

```sh
node validate.mjs example-article.json my-article.json
```
