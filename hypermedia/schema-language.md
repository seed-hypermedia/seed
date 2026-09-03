---
name: The Onyx Schema Language
summary: The full Onyx vocabulary — closed maps, unions, generics, extension, and how the meta-schema describes itself.
---
# The Onyx schema language <!-- id:yngrdImL -->

An Onyx schema is a single value of kind `map`. It uses **thirteen core keys**, all optional, plus a handful of optional value constraints (below). That is the entire language. <!-- id:EXSoVP3S -->

<!-- id:7guJrYQy -->
| key <!-- col:PPQxsZds --> | applies to <!-- col:arAp45HF --> | meaning <!-- col:OMQjDwG3 --> <!-- id:lyC-RqMi --> |
| --- | --- | --- |
| `type` | any | the kind — an `hm://` URL naming one of the nine (see [the data model](./data-model.md)) <!-- id:hwpC2KX7 --> |
| `properties` | `map` | a map of known field name → schema <!-- id:InbInGwv --> |
| `required` | `map` | list of field names that must be present <!-- id:zo28a4vv --> |
| `items` | `list` | schema every element must match <!-- id:GxgxLBO8 --> |
| `values` | `map` | schema every _value_ must match (open map / record) <!-- id:lBxL68T_ --> |
| `enum` | any | list of allowed literal values <!-- id:Jh3SOAp5 --> |
| `ref` | any | a reference to another schema — an `hm://` URL (see [references](./references.md)) <!-- id:8kpIEN7j --> |
| `anyOf` | any | a **union**: the value must match one of the listed schemas <!-- id:Ww-tAztO --> |
| `params` | any | declares type parameters (generics), each with a default <!-- id:LmVM4b91 --> |
| `var` | any | a reference to a type parameter — `{ "var": "B" }` <!-- id:MeJc4pL2 --> |
| `args` | reference | applies a generic, binding its parameters <!-- id:CAIxcz9j --> |
| `name` | any | a human-readable name for the schema (metadata; ignored when validating data) <!-- id:vCbTeSgE --> |
| `description` | any | a human-readable description (metadata; ignored when validating data) <!-- id:hv4WT6n0 --> |

`name` and `description` are **metadata** — they annotate the schema, not the data, so the validator ignores them when checking a value, and the schema explorer renders them as each schema's title and blurb. (A schema's `name` is unrelated to a field named `name` inside its `properties` — different levels.) <!-- id:GROkvj0R -->

Both `type` and `ref` values are `hm://` URLs, so they are clickable and self-explanatory: `type` is `"hm://hyper.media/map"`, not a bare `"map"`. **For readability these docs abbreviate `hm://hyper.media/map` as just `map`** — but the real value is always the URL. <!-- id:SZ-BjsVR -->

A node with only `ref` (and no `type`) is an **include**: it becomes whatever the referenced schema says. Add refinement keys and it becomes an **extension** (below). A node with `type:"link"` _and_ `ref` is a **typed link**: a link whose target should match the referenced schema. <!-- id:wxGU9ndD -->

## Extension (subtyping) <!-- id:go7Qda14 -->

A reference node that _also_ carries refinements **extends** the schema it points at — a subtype with the parent's fields plus new ones. The worked example is `example-employee`, which extends `example-person`: <!-- id:c6VcyJfa -->

```json <!-- id:fnvdYhmQ -->
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

Open `example-employee` in the schema explorer to see the merged result — every field marked _inherited_ or _added_. <!-- id:rBtaiBHO -->

The rules, all reusing existing keywords — no `extends` keyword needed: <!-- id:A9LrCpUD -->
  - `properties` are **merged** (parent's + the extension's; same-named keys override). <!-- id:Zkb8fXkn -->
  - `required` is the **union** of both. <!-- id:lk-pEXZe -->
  - `values` / `items` on the extension override the parent's. <!-- id:jK0_muct -->
  - the result keeps the parent's kind and closedness — so an employee must have `name` (inherited-required) **and** `employeeId` (added-required), may use any inherited field, and still rejects unknown keys. <!-- id:jmFaI8J0 -->

A **bare** `{ "ref": X }` (no refinements) is a pure include, not an extension. The distinction is exactly whether refinements are present. This is validated by `validate.mjs` (see the `employee data` / `extension …` checks). <!-- id:QzURq80i -->

## Closed maps <!-- id:SFVk1Mph -->

A `map` with `properties` and **no** `values` is **closed**: keys not listed in `properties` are rejected. Add `values` and the map is open — extra keys are allowed as long as their values match the `values` schema. So: <!-- id:8FWAU877 -->
  - `properties`, no `values` → **closed struct** (fixed field set) <!-- id:AjvS967n -->
  - `values`, no `properties` → **open map** (uniform value type, any keys) <!-- id:e1GSoOu5 -->
  - both → known fields via `properties`, everything else must match `values` <!-- id:3wP9hZuQ -->
  - neither → any map <!-- id:0R9RPaBS -->

```json <!-- id:KIYtikI2 -->
// closed struct — {name, age} and nothing else
{ "type": "map", "required": ["name"],
  "properties": { "name": { "type": "string" }, "age": { "type": "integer" } } }
```

```json <!-- id:uOkzD_Gb -->
// open map — arbitrary keys, integer values
{ "type": "map", "values": { "type": "integer" } }
```

Closedness is what lets the meta-schema _reject_ malformed schemas rather than shrug at extra keys (see below). <!-- id:bP4jTzqq -->

## Value constraints <!-- id:DVRwHp1m -->

Beyond the kind, a schema may narrow the _values_ a leaf accepts. Every constraint is optional; absent means unconstrained. They are all checked by `validate.mjs` (see the `Value constraints` section) and `example-constrained` exercises them together. <!-- id:d2OgTbaT -->

<!-- id:ePFO5CZ6 -->
| key <!-- col:LGrl5hdK --> | applies to <!-- col:SZYGj3li --> | meaning <!-- col:X_e0Bwsx --> <!-- id:FJBhhPv1 --> |
| --- | --- | --- |
| `minLength` | `string` | minimum length, counted in **code points** <!-- id:eTvANQ7B --> |
| `maxLength` | `string` | maximum length, counted in **code points** <!-- id:NHnyTLTT --> |
| `pattern` | `string` | an **unanchored** ECMAScript regular expression the value must match; an uncompilable pattern is ignored <!-- id:ft1VaQeN --> |
| `minimum` | `integer` / `float` | value must be ≥ this number <!-- id:CM8SZUXN --> |
| `maximum` | `integer` / `float` | value must be ≤ this number <!-- id:pBOqKr74 --> |
| `minItems` | `list` | minimum number of elements <!-- id:y_OlIa-N --> |
| `maxItems` | `list` | maximum number of elements <!-- id:f6qBJIXh --> |

```json <!-- id:RBAU34K6 -->
// a lowercase handle, 3–12 code points, matching a pattern
{ "type": "hm://hyper.media/string",
  "minLength": 3, "maxLength": 12, "pattern": "^[a-z0-9_]+$" }
```

These are the value constraints folded in from the "Seed Blob Schema v1" dialect. `validate()` reports each violation as an error string (e.g. `$.username: expected at least 3 characters`); the exported `validateAdvisory()` wrapper runs the identical checks but is documented as **warn-don't-block** — callers surface its result as warnings rather than rejecting a write. <!-- id:u0B-Olx9 -->

## Unions <!-- id:4Zeb0ssB -->

`anyOf` lists alternative schemas; a value is valid if it matches **any** of them. This is Onyx's one composite construct, and it is what makes the meta-schema a _discriminated union_ — a value is one of a fixed set of shapes, told apart by a discriminant (here, the `type` tag). <!-- id:vsWv7IZH -->

```json <!-- id:DmjMbc7m -->
{ "anyOf": [ { "ref": "onyx-map-schema" }, { "ref": "onyx-link-schema" } ] }
```

## Generics <!-- id:Any3hnDc -->

Onyx has both flavours of generic. <!-- id:GUz2-s2k -->

**Applied generics** — supplying a type parameter concretely — come for free from `items` and `values`: <!-- id:wY_2EAUG -->
  - `list` + `items` = `List<T>` — `items` is `T` <!-- id:aZPTtuab -->
  - `map` + `values` = `Map<V>` — `values` is `V` <!-- id:aY249UNO -->

So `{"Apples":5,"Oranges":3}` is `Map<Integer>`, written `example-counts`: `{ "type":"map", "values":{ "ref":"onyx-integer" } }`. It nests all the way down. <!-- id:-Yhf7y6_ -->

**Generic abstraction** — defining a reusable parameterized type and instantiating it later — is expressed with three keys: <!-- id:s5ZsDksV -->

<!-- id:wD_cjjbP -->
| key <!-- col:ZdQs1aS6 --> | meaning <!-- col:qyZSsTwz --> <!-- id:J9JCB24S --> |
| --- | --- |
| `params` | declares type parameters, each with a default: `{ "params": { "B": <default> }, … }` <!-- id:lIs7tAVg --> |
| `var` | a **type-variable reference**: `{ "var": "B" }` matches whatever `B` is bound to <!-- id:5aEIR885 --> |
| `args` | **applies** a generic, binding its params: `{ "ref": X, "args": { "B": <schema> } }` <!-- id:4XYh4mx3 --> |

The parameter threads through references (each level passes it down with `args`), so binding it at the top substitutes it everywhere. The worked example is `hypermedia-change` — a `Change<Block>` whose `Block` parameter flows through `change → change-body → op → op-replace-block` — and its instantiation `example-myapp-change` = `Change<example-app-block>`, which validates blocks _strictly_ deep inside the op stack (see the `Generics: Change<Block>` checks in `validate.mjs`). Used bare, a generic falls back to its parameter defaults, so the common case needs no `args`. <!-- id:DcFRFUv9 -->

## How Onyx describes itself <!-- id:zWshFjlg -->

This is the crux, and with unions it is sharper than "a loose map with optional keys." `onyx-schema` is a **discriminated union of seven variants** — the seven shapes a schema can take: <!-- id:lI_lySSK -->

<!-- id:yZg8-sNO -->
| variant <!-- col:kO3_qHrQ --> | matches <!-- col:rCN3fgm3 --> | discriminant <!-- col:zzQn7svL --> <!-- id:4VFkvrKJ --> |
| --- | --- | --- |
| `onyx-map-schema` | `{type:"map", properties?, required?, values?}` | `type` = `map` <!-- id:bCtL9MQx --> |
| `onyx-list-schema` | `{type:"list", items?}` | `type` = `list` <!-- id:Y2gJAANc --> |
| `onyx-scalar-schema` | `{type: null\|boolean\|integer\|float\|string\|bytes, enum?}` | `type` = a scalar kind <!-- id:wkuOsUIy --> |
| `onyx-link-schema` | `{type:"link", ref?}` | `type` = `link` <!-- id:GXuPWZG4 --> |
| `onyx-include-schema` | `{ref}` | no `type` <!-- id:sBVesN99 --> |
| `onyx-union-schema` | `{anyOf:[schema, …]}` | has `anyOf` <!-- id:uRuXGK92 --> |
| `onyx-var-schema` | `{var}` | has `var` <!-- id:nw86Dhqn --> |

Each variant is a **closed** map, so a nonsense schema like `{type:"string", items:{…}}` matches _none_ of them — the stray `items` key is rejected by the closed `onyx-scalar-schema`, and the wrong `type` tag rules out the others. Run it: <!-- id:j-_t0aVk -->

```sh <!-- id:yezLjFqJ -->
node validate.mjs
#   ok   rejects a string-that-is-also-a-list-and-struct (rejected)
```

### Why it still closes the loop — and deepens it <!-- id:cAg3Oszt -->

`onyx-schema` is `{ "anyOf": [ …seven refs… ] }`. Validate it against itself: <!-- id:Gjr5KNDl -->
  1. It matches the **`onyx-union-schema`** variant (it has an `anyOf` that is a list of schemas). <!-- id:deE1RQMk -->
  2. Each item in that `anyOf` is a bare `{ref: …}`, which matches the **`onyx-include-schema`** variant. <!-- id:yYBUIRiY -->
  3. Each variant file (e.g. `onyx-map-schema`) is itself a `{type:"map", …}`, which matches the **`onyx-map-schema`** variant. <!-- id:3RbdlEZc -->

The meta-schema is a union whose variants _include a union variant_, and it validates as that variant. The fixed point holds one level richer than before. <!-- id:pUf5EFPl -->

Note the standing of `type`. Nothing defines the string `"map"`; a variant just lists it in an `enum` of allowed kind-names. `string`, `link`, and `bytes` sit in those enums with no special treatment — the language names kinds, it does not define them. <!-- id:8YmU20RL -->

## The proof is executable <!-- id:pnI1No8b -->

`validate.mjs` validates `onyx-schema` against itself, every variant against the union, and confirms the union _rejects_ malformed schemas. It is not prose; it is a check you can run: <!-- id:R4Z6LPtc -->

```sh <!-- id:PxteeEDG -->
node validate.mjs
#   ok   onyx-schema.json describes itself
#   ok   onyx-map-schema.json is a valid schema
#   ...
#   ok   rejects a string-that-is-also-a-list-and-struct (rejected)
```

If you extend the vocabulary, run it again — if the union can no longer describe its own new shape, the loop is broken and this fails. <!-- id:vGjbVugA -->
