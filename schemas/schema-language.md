# The Onyx schema language

An Onyx schema is a single value of kind `map`. It uses **eight keys**, all
optional. That is the entire language.

| key | applies to | meaning |
| --- | --- | --- |
| `type` | any | the kind — an `hm://` URL naming one of the nine (see [data-model.md](./data-model.md)) |
| `properties` | `map` | a map of known field name → schema |
| `required` | `map` | list of field names that must be present |
| `items` | `list` | schema every element must match |
| `values` | `map` | schema every *value* must match (open map / record) |
| `enum` | any | list of allowed literal values |
| `ref` | any | a reference to another schema — an `hm://` URL (see [references.md](./references.md)) |
| `anyOf` | any | a **union**: the value must match one of the listed schemas |

Both `type` and `ref` values are `hm://` URLs, so they are clickable and
self-explanatory: `type` is `"hm://hyper.media/map"`, not a bare `"map"`. **For
readability these docs abbreviate `hm://hyper.media/map` as just `map`** — but
the real value is always the URL.

A node with only `ref` (and no `type`) is an **include**: it becomes whatever
the referenced schema says. Add refinement keys and it becomes an **extension**
(below). A node with `type:"link"` *and* `ref` is a **typed link**: a link whose
target should match the referenced schema.

## Extension (subtyping)

A reference node that *also* carries refinements **extends** the schema it
points at — a subtype with the parent's fields plus new ones:

```json
// example-employee = example-person, plus employeeId and department
{
  "ref": "hm://example.com/person",
  "required": ["employeeId"],
  "properties": {
    "employeeId": { "ref": "hm://hyper.media/string" },
    "department": { "ref": "hm://hyper.media/string" }
  }
}
```

The rules, all reusing existing keywords — no `extends` keyword needed:

- `properties` are **merged** (parent's + the extension's; same-named keys override).
- `required` is the **union** of both.
- `values` / `items` on the extension override the parent's.
- the result keeps the parent's kind and closedness — so an employee must have
  `name` (inherited-required) **and** `employeeId` (added-required), may use any
  inherited field, and still rejects unknown keys.

A **bare** `{ "ref": X }` (no refinements) is a pure include, not an extension.
The distinction is exactly whether refinements are present. This is validated by
[`validate.mjs`](./validate.mjs) (see the `employee data` / `extension …`
checks).

## Closed maps

A `map` with `properties` and **no** `values` is **closed**: keys not listed in
`properties` are rejected. Add `values` and the map is open — extra keys are
allowed as long as their values match the `values` schema. So:

- `properties`, no `values` → **closed struct** (fixed field set)
- `values`, no `properties` → **open map** (uniform value type, any keys)
- both → known fields via `properties`, everything else must match `values`
- neither → any map

```json
// closed struct — {name, age} and nothing else
{ "type": "map", "required": ["name"],
  "properties": { "name": { "type": "string" }, "age": { "type": "integer" } } }
```

```json
// open map — arbitrary keys, integer values
{ "type": "map", "values": { "type": "integer" } }
```

Closedness is what lets the meta-schema *reject* malformed schemas rather than
shrug at extra keys (see below).

## Unions

`anyOf` lists alternative schemas; a value is valid if it matches **any** of
them. This is Onyx's one composite construct, and it is what makes the
meta-schema a *discriminated union* — a value is one of a fixed set of shapes,
told apart by a discriminant (here, the `type` tag).

```json
{ "anyOf": [ { "ref": "onyx-map-schema.json" }, { "ref": "onyx-link-schema.json" } ] }
```

## Generics (applied)

Onyx has no type *variables*, but it does have parametric containers, because
`items` and `values` **are** the type parameters:

- `list` + `items` = `List<T>` — `items` is `T`
- `map` + `values` = `Map<V>` — `values` is `V`

So `{"Apples":5,"Oranges":3}` is not merely a `map`; it is `Map<Integer>`,
written [`example-counts.json`](./example-counts.json):

```json
{ "type": "map", "values": { "ref": "onyx-integer.json" } }
```

The parameter is supplied concretely, and it nests: `Map<List<Integer>>` is
`{"type":"map","values":{"type":"list","items":{"ref":"onyx-integer.json"}}}` all
the way down. `onyx-map` (`{type:"map"}`, no `values`) is the unparameterized
`Map<Any>`; `onyx-list` is `List<Any>`.

What Onyx lacks is generic *abstraction* — you cannot define a reusable
`MapOf<T>` with a **variable** `T` and instantiate it later. Each concrete
container type is written out (or referenced). That is a deliberate limit:
type variables would be new vocabulary the meta-schema must also describe about
itself. See [design-rationale.md](./design-rationale.md).

## How Onyx describes itself

This is the crux, and with unions it is sharper than "a loose map with optional
keys." [`onyx-schema.json`](./onyx-schema.json) is a **discriminated union of six
variants** — the six shapes a schema can take:

| variant | matches | discriminant |
| --- | --- | --- |
| [`onyx-map-schema`](./onyx-map-schema.json) | `{type:"map", properties?, required?, values?}` | `type` = `map` |
| [`onyx-list-schema`](./onyx-list-schema.json) | `{type:"list", items?}` | `type` = `list` |
| [`onyx-scalar-schema`](./onyx-scalar-schema.json) | `{type: null\|boolean\|integer\|float\|string\|bytes, enum?}` | `type` = a scalar kind |
| [`onyx-link-schema`](./onyx-link-schema.json) | `{type:"link", ref?}` | `type` = `link` |
| [`onyx-include-schema`](./onyx-include-schema.json) | `{ref}` | no `type` |
| [`onyx-union-schema`](./onyx-union-schema.json) | `{anyOf:[schema, …]}` | has `anyOf` |

Each variant is a **closed** map, so a nonsense schema like `{type:"string",
items:{…}}` matches *none* of them — the stray `items` key is rejected by the
closed `onyx-scalar-schema`, and the wrong `type` tag rules out the others. Run it:

```sh
node validate.mjs
#   ok   rejects a string-that-is-also-a-list-and-struct (rejected)
```

### Why it still closes the loop — and deepens it

`onyx-schema.json` is `{ "anyOf": [ …six refs… ] }`. Validate it against itself:

1. It matches the **`onyx-union-schema`** variant (it has an `anyOf` that is a list of schemas).
2. Each item in that `anyOf` is a bare `{ref: …}`, which matches the **`onyx-include-schema`** variant.
3. Each variant file (e.g. `onyx-map-schema.json`) is itself a `{type:"map", …}`, which matches the **`onyx-map-schema`** variant.

The meta-schema is a union whose variants *include a union variant*, and it
validates as that variant. The fixed point holds one level richer than before.

Note the standing of `type`. Nothing defines the string `"map"`; a variant just
lists it in an `enum` of allowed kind-names. `string`, `link`, and `bytes` sit
in those enums with no special treatment — the language names kinds, it does not
define them.

## The proof is executable

[`validate.mjs`](./validate.mjs) validates `onyx-schema.json` against itself, every
variant against the union, and confirms the union *rejects* malformed schemas.
It is not prose; it is a check you can run:

```sh
node validate.mjs
#   ok   onyx-schema.json describes itself
#   ok   onyx-map-schema.json is a valid schema
#   ...
#   ok   rejects a string-that-is-also-a-list-and-struct (rejected)
```

If you extend the vocabulary, run it again — if the union can no longer describe
its own new shape, the loop is broken and this fails.
