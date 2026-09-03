---
name: Examples
summary: A catalog of every Onyx example schema — structs, enums, generics, unions, recursion, extension, and live instances.
---
# Onyx examples <!-- id:HKSIPG2Z -->

Every example here is a schema built _with_ Onyx, published under the `hm://example.com/*` authority (local files are `example-*.json`). Each one demonstrates a specific feature, links to others, and is checked by `validate.mjs` — validated as a well-formed schema, plus positive and negative **data** cases. <!-- id:eYTB9M9t -->

## Structs & primitives <!-- id:oGPlvmvN -->

- `example-address` — a closed struct of three strings. <!-- id:Nacs_YWm -->
- `example-geo` — `float` lat/lng + `integer` altitude. <!-- id:g8yBWfUc -->
- `example-person` — strings, an `integer`, a `boolean`, an [include](./references.md) of an address, and a list. <!-- id:nVLVzwuR -->
- `example-blob` — a `bytes` payload with a mime string and size. <!-- id:C-1sn3aB -->

## Enums <!-- id:eDkgeHDg -->

- `example-status` — a `string` restricted to `draft | published | archived` (an `enum` refinement on the string primitive). <!-- id:25xmLnuT -->

## Generics — list & map ([schema language](./schema-language.md)) <!-- id:Litrltyz -->

- `example-tags` — `List<String>`. <!-- id:ADxHncd4 -->
- `example-matrix` — `List<List<Integer>>` (nested). <!-- id:ZFp9DXan -->
- `example-metadata` — `Map<String>` (open map). <!-- id:37dvuu1i -->
- `example-registry` — `Map<Link<Person>>`. <!-- id:pCrPxAmI -->
- `example-counts` — `Map<Integer>` (the worked example). <!-- id:B35K3M5Y -->

## Unions ([schema language](./schema-language.md)) <!-- id:TRiT5pPB -->

- `example-value` — `anyOf` string / integer / boolean / null. <!-- id:Ml4Hpn53 -->
- `example-entry` — a filesystem entry: a folder **or** a file. <!-- id:SMzNJ2fD -->
- `example-json` — the classic **recursive union**: a JSON value is null, bool, number, string, `List<json>`, or `Map<json>`. It references _itself_. <!-- id:EUKbD7wt -->

## Recursion ([references](./references.md)) <!-- id:ngPnGEkV -->

Only possible because references are **names**, not content hashes: <!-- id:yZkCj7Y4 -->
  - `example-document` — self-reference (`previous` → another document). <!-- id:ymvJqId7 -->
  - `example-comment` — a thread: a comment's `replies` are comments. <!-- id:aojXrSvY -->
  - `example-tree` — a node with child nodes. <!-- id:XQAu127V -->
  - `example-folder` ↔ `example-file` — **mutual** recursion; click folder → file → folder in a circle. <!-- id:2ekiJzl0 -->

## Extension — subtyping ([schema language](./schema-language.md)) <!-- id:_Zyt3Gct -->

- `example-employee` — extends `example-person` with `employeeId` + `department`. <!-- id:ZnIPWts0 -->
- `example-admin` — extends `example-employee` (a two-level chain admin → employee → person) with `permissions`. <!-- id:fQ7YGect -->

## Composite <!-- id:5sNzM3wJ -->

- `example-article` — the centerpiece, pulling it together: a `status` enum, an author `Link<Person>`, `tags` (`List<String>`), a `bytes` body, `wordCount`, a cover `Link<Blob>`, a list of comment links, and open `Map<String>` metadata. Deeply linked to `example-status`, `example-tags`, `example-person`, `example-blob`, `example-comment`, and `example-metadata`. <!-- id:iZHzPdc_ -->

## Instances — actual data <!-- id:xxv3d5ho -->

An **instance** is a data value typed by a schema: `{ "$type": <schema>, "value": … }`. Each is validated live against its type, and each page shows **Dependencies** (its type) and **Dependents**. They form a dependency chain — `bob` → `employee` → `person`: <!-- id:QS_X-Qc7 -->
  - `example-alice`, `example-carol` — people (instances of `example-person`). <!-- id:s7bGoabh -->
  - `example-bob`, `example-dave` — employees (instances of `example-employee`). <!-- id:i37qO0Qw -->
  - `example-root` — an admin (instance of `example-admin`, which is itself two levels of extension). <!-- id:9HYSH6eG -->

Every schema and instance page shows what it **depends on** and what **depends on it** — so from `example-person` you can see its dependents (`example-employee`, plus `alice` and `carol`), and from `bob` you can walk up to `employee` and `person`. <!-- id:3m3eZzyL -->

\--- <!-- id:_779N9tY -->

To validate any of these against your own data: <!-- id:yOWgEY01 -->

```sh <!-- id:wqTx5NHe -->
node validate.mjs example-article.json my-article.json
```
