---
name: The Onyx Schema Language
summary: The full Onyx vocabulary — closed maps, unions, generics, extension, and how the meta-schema describes itself.
---

# The Onyx schema language

An Onyx schema is a single value of kind `map`. It uses **thirteen core keys**,
all optional, plus a handful of optional value constraints
(below). That is the entire language.

| key | applies to | meaning |
| --- | --- | --- |
| `type` | any | the kind — an `hm://` URL naming one of the nine (see [the data model](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/data-model)) |
| `properties` | `map` | a map of known field name → schema |
| `required` | `map` | list of field names that must be present |
| `items` | `list` | schema every element must match |
| `values` | `map` | schema every *value* must match (open map / record) |
| `enum` | any | list of allowed literal values |
| `ref` | any | a reference to another schema — an `hm://` URL (see [references](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references)) |
| `anyOf` | any | a **union**: the value must match one of the listed schemas |
| `params` | any | declares type parameters (generics), each with a default |
| `var` | any | a reference to a type parameter — `{ "var": "B" }` |
| `args` | reference | applies a generic, binding its parameters |
| `name` | any | a human-readable name for the schema (metadata; ignored when validating data) |
| `description` | any | a human-readable description (metadata; ignored when validating data) |

`name` and `description` are **metadata** — they annotate the schema, not the
data, so the validator ignores them when checking a value, and the schema
explorer renders them as each schema's title and blurb. (A schema's `name` is
unrelated to a field named `name` inside its `properties` — different levels.)

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
points at — a subtype with the parent's fields plus new ones. The worked example
is `example-employee`, which extends
`example-person`:

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

Open `example-employee` in the schema explorer to see the
merged result — every field marked *inherited* or *added*.

The rules, all reusing existing keywords — no `extends` keyword needed:

- `properties` are **merged** (parent's + the extension's; same-named keys override).
- `required` is the **union** of both.
- `values` / `items` on the extension override the parent's.
- the result keeps the parent's kind and closedness — so an employee must have
  `name` (inherited-required) **and** `employeeId` (added-required), may use any
  inherited field, and still rejects unknown keys.

A **bare** `{ "ref": X }` (no refinements) is a pure include, not an extension.
The distinction is exactly whether refinements are present. This is validated by
`validate.mjs` (see the `employee data` / `extension …`
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

## Value constraints

Beyond the kind, a schema may narrow the *values* a leaf accepts. Every
constraint is optional; absent means unconstrained. They are all checked by
`validate.mjs` (see the `Value constraints` section) and
`example-constrained` exercises them together.

| key | applies to | meaning |
| --- | --- | --- |
| `minLength` | `string` | minimum length, counted in **code points** |
| `maxLength` | `string` | maximum length, counted in **code points** |
| `pattern` | `string` | an **unanchored** ECMAScript regular expression the value must match; an uncompilable pattern is ignored |
| `minimum` | `integer` / `float` | value must be ≥ this number |
| `maximum` | `integer` / `float` | value must be ≤ this number |
| `minItems` | `list` | minimum number of elements |
| `maxItems` | `list` | maximum number of elements |

```json
// a lowercase handle, 3–12 code points, matching a pattern
{ "type": "hm://hyper.media/string",
  "minLength": 3, "maxLength": 12, "pattern": "^[a-z0-9_]+$" }
```

These are the value constraints folded in from the "Seed Blob Schema v1"
dialect. `validate()` reports each violation as an error string (e.g.
`$.username: expected at least 3 characters`); the exported `validateAdvisory()`
wrapper runs the identical checks but is documented as **warn-don't-block** —
callers surface its result as warnings rather than rejecting a write.

## Unions

`anyOf` lists alternative schemas; a value is valid if it matches **any** of
them. This is Onyx's one composite construct, and it is what makes the
meta-schema a *discriminated union* — a value is one of a fixed set of shapes,
told apart by a discriminant (here, the `type` tag).

```json
{ "anyOf": [ { "ref": "onyx-map-schema" }, { "ref": "onyx-link-schema" } ] }
```

## Generics

Onyx has both flavours of generic.

**Applied generics** — supplying a type parameter concretely — come for free from
`items` and `values`:

- `list` + `items` = `List<T>` — `items` is `T`
- `map` + `values` = `Map<V>` — `values` is `V`

So `{"Apples":5,"Oranges":3}` is `Map<Integer>`, written
`example-counts`: `{ "type":"map", "values":{ "ref":"onyx-integer" } }`.
It nests all the way down.

**Generic abstraction** — defining a reusable parameterized type and
instantiating it later — is expressed with three keys:

| key | meaning |
| --- | --- |
| `params` | declares type parameters, each with a default: `{ "params": { "B": <default> }, … }` |
| `var` | a **type-variable reference**: `{ "var": "B" }` matches whatever `B` is bound to |
| `args` | **applies** a generic, binding its params: `{ "ref": X, "args": { "B": <schema> } }` |

The parameter threads through references (each level passes it down with `args`),
so binding it at the top substitutes it everywhere. The worked example is
`hypermedia-change` — a `Change<Block>` whose `Block`
parameter flows through `change → change-body → op → op-replace-block` — and its
instantiation `example-myapp-change` =
`Change<example-app-block>`, which validates blocks *strictly* deep inside the op
stack (see the `Generics: Change<Block>` checks in `validate.mjs`).
Used bare, a generic falls back to its parameter defaults, so the common case
needs no `args`.

## How Onyx describes itself

This is the crux, and with unions it is sharper than "a loose map with optional
keys." `onyx-schema` is a **discriminated union of seven
variants** — the seven shapes a schema can take:

| variant | matches | discriminant |
| --- | --- | --- |
| `onyx-map-schema` | `{type:"map", properties?, required?, values?}` | `type` = `map` |
| `onyx-list-schema` | `{type:"list", items?}` | `type` = `list` |
| `onyx-scalar-schema` | `{type: null\|boolean\|integer\|float\|string\|bytes, enum?}` | `type` = a scalar kind |
| `onyx-link-schema` | `{type:"link", ref?}` | `type` = `link` |
| `onyx-include-schema` | `{ref}` | no `type` |
| `onyx-union-schema` | `{anyOf:[schema, …]}` | has `anyOf` |
| `onyx-var-schema` | `{var}` | has `var` |

Each variant is a **closed** map, so a nonsense schema like `{type:"string",
items:{…}}` matches *none* of them — the stray `items` key is rejected by the
closed `onyx-scalar-schema`, and the wrong `type` tag rules out the others. Run it:

```sh
node validate.mjs
#   ok   rejects a string-that-is-also-a-list-and-struct (rejected)
```

### Why it still closes the loop — and deepens it

`onyx-schema` is `{ "anyOf": [ …seven refs… ] }`. Validate it against itself:

1. It matches the **`onyx-union-schema`** variant (it has an `anyOf` that is a list of schemas).
2. Each item in that `anyOf` is a bare `{ref: …}`, which matches the **`onyx-include-schema`** variant.
3. Each variant file (e.g. `onyx-map-schema`) is itself a `{type:"map", …}`, which matches the **`onyx-map-schema`** variant.

The meta-schema is a union whose variants *include a union variant*, and it
validates as that variant. The fixed point holds one level richer than before.

Note the standing of `type`. Nothing defines the string `"map"`; a variant just
lists it in an `enum` of allowed kind-names. `string`, `link`, and `bytes` sit
in those enums with no special treatment — the language names kinds, it does not
define them.

## The proof is executable

`validate.mjs` validates `onyx-schema` against itself, every
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
