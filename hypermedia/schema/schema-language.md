---
name: Schema Language
summary: The full schema vocabulary, covering closed maps, unions, generics, extension, and how the meta-schema describes itself.
---
# The schema language <!-- id:yngrdImL -->

A [Hypermedia schema](../schema.md) is a value of [kind](./kind.md) `map` built from **twelve core keys**, all optional, plus a few optional value constraints (below). It can also be a **literal**: a bare `null`, boolean, integer, or string, which accepts exactly that value. That is the whole language. <!-- id:EXSoVP3S -->

<!-- id:7guJrYQy -->
| key <!-- col:PPQxsZds --> | applies to <!-- col:arAp45HF --> | meaning <!-- col:OMQjDwG3 --> <!-- id:lyC-RqMi --> |
| --- | --- | --- |
| `type` | any | what this node **is**: an `hm://` URL naming one of the nine kinds (see [the data model](./data-model.md)) or naming another schema (see [references](./references.md)) <!-- id:hwpC2KX7 --> |
| `properties` | `map` | a map of known field name to schema <!-- id:InbInGwv --> |
| `items` | `list` | schema every element must match <!-- id:GxgxLBO8 --> |
| `values` | `map` | schema every _value_ must match (open map / record) <!-- id:lBxL68T_ --> |
| `value` | literal | the one value a literal schema accepts, when the literal needs a `description` (see below) <!-- id:Jh3SOAp5 --> |
| `target` | `link`, reference string | the schema the pointed-at block or document is expected to conform to (see [references](./references.md)) <!-- id:8kpIEN7j --> |
| `anyOf` | any | a **union**: the value must match one of the listed schemas <!-- id:Ww-tAztO --> |
| `params` | any | declares type parameters (generics), each with a default <!-- id:LmVM4b91 --> |
| `var` | any | a reference to a type parameter: `{ "var": "B" }` <!-- id:MeJc4pL2 --> |
| `args` | reference | applies a generic, binding its parameters <!-- id:CAIxcz9j --> |
| `name` | any | a human-readable name for the schema (metadata; ignored when validating data) <!-- id:vCbTeSgE --> |
| `description` | any | a human-readable description (metadata; ignored when validating data) <!-- id:hv4WT6n0 --> |

`name` and `description` are **metadata** about the schema. The validator ignores them when it checks a value, and the schema explorer shows them as each schema's title and blurb. A schema's `name` has nothing to do with a field called `name` inside its `properties`. <!-- id:GROkvj0R -->

A `type` value is always an [`hm://` URL](../hm-url.md), whether it names a kind or another schema, so every type is clickable. The real value is `"hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/map"`. **For readability these docs shorten `hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/map` to `map`.** Examples use the same library account: `example/person` is `hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example/person`. <!-- id:SZ-BjsVR -->

## Literals <!-- id:Lit1eral -->

A **[literal](./literal-schema.md)** schema accepts exactly one value, and is written as that value: `"draft"`, `1`, `true`, `null`. A literal can be a string, an integer, a boolean, or null (the [value](../value.md) union). It can never be a float, a map, or a list. A union of literals restricts a field to a fixed set of choices. Each choice can carry a description in the long form `{value, description}`: <!-- id:Lit2eral -->

```json <!-- id:Lit3eral -->
// a status field: one of three values, one of them explained
"status": { "value": { "anyOf": [
  "draft",
  { "value": "published", "description": "Visible to everyone" },
  "archived"
] } }

// a tag field pinned to one value — the whole schema is the literal
"type": { "value": "Change", "required": true }
```

Every signed [blob](../protocol/blobs.md) type pins its `type` this way, and every RPC method schema pins its `key`. In TypeScript they become literal types (`type: 'Change'`, `'draft' | 'published' | 'archived'`). <!-- id:Lit4eral -->

One rule governs the whole language: **`type` names what a node is, and every other key refines what it names.** If `type` names one of the nine kinds, the schema is grounded there. If it names _another schema_, the node is an **[include](./include-schema.md)**. With nothing else on the node, it becomes whatever that schema says. Add any refinement and it becomes an **[extension](./extension.md)** (below). The refinement can be structural (`properties`, `values`, `items`) or a leaf constraint (`format`, `pattern`, `minLength`, `target`, …), and the rule is the same. A node with `type:"link"` and a `target` is a **typed [link](../link.md)**: a link whose target should match the named schema. <!-- id:wxGU9ndD -->

## Extension (subtyping) <!-- id:go7Qda14 -->

A node whose `type` names another schema and that _also_ carries refinements **extends** what it names. The result is a subtype with the parent's fields plus new ones. The worked example is [`example/employee`](../example/employee.md), which extends `example/person`: <!-- id:c6VcyJfa -->

```json <!-- id:fnvdYhmQ -->
// example/employee = example/person, plus employeeId and department
{
  "type": "hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example/person",
  "properties": {
    "employeeId": { "value": { "type": "hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string" }, "required": true },
    "department": { "value": { "type": "hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string" } }
  }
}
```

Open `example/employee` in the schema explorer to see the merged result, with every field marked _inherited_ or _added_. <!-- id:rBtaiBHO -->

The rules reuse existing keywords, so there is no `extends` keyword: <!-- id:A9LrCpUD -->
  - `properties` are **merged**: the parent's plus the extension's, and same-named keys override. Each is a [property](./property.md), so a field's required flag travels with it. <!-- id:Zkb8fXkn -->
  - `values` / `items` on the extension override the parent's. <!-- id:jK0_muct -->
  - the result keeps the parent's kind and closedness. An employee must have `name` (required on the parent) **and** `employeeId` (required on the extension), may use any inherited field, and still rejects unknown keys. <!-- id:jmFaI8J0 -->

A **bare** `{ "type": X }`, where X names another schema and the node has nothing else, is a pure include. It becomes an extension only when a refinement is present. `validate.mjs` checks this (see the `example/employee.schema` checks and `an extension can pin a field to a literal`). <!-- id:QzURq80i -->

## Structs and maps <!-- id:SFVk1Mph -->

A [`struct`](../struct.md) names its fields in `properties`, one [property](./property.md) per field. `properties[name]` is `{value, required?, description?}`: the schema the field's value must match, whether a value must include the field, and what the field is for. A struct is **[closed](./closed-map.md)**, so keys not listed are rejected. Add `values` and it is open: extra keys are allowed as long as their values match the `values` schema. A [`map`](../map.md) has no named fields, and every key's value matches `values`. So: <!-- id:8FWAU877 -->
  - `struct` with `properties` and no `values` is a **closed struct** (fixed field set) <!-- id:AjvS967n -->
  - `map` with `values` is a **map** (uniform value type, any keys) <!-- id:e1GSoOu5 -->
  - `struct` with both has known fields in `properties`, and everything else must match `values` <!-- id:3wP9hZuQ -->
  - a bare `map` or `struct` accepts any map <!-- id:0R9RPaBS -->

```json <!-- id:KIYtikI2 -->
// closed struct — {name, age} and nothing else
{ "type": "struct",
  "properties": {
    "name": { "value": { "type": "string" }, "required": true, "description": "Full name" },
    "age":  { "value": { "type": "integer" } } } }
```

```json <!-- id:uOkzD_Gb -->
// open map — arbitrary keys, integer values
{ "type": "map", "values": { "type": "integer" } }
```

Closedness lets the meta-schema _reject_ malformed schemas with extra keys (see below). <!-- id:bP4jTzqq -->

## Value constraints <!-- id:DVRwHp1m -->

Beyond the kind, a schema can narrow the _values_ a leaf accepts. Every constraint is optional, and a missing constraint means no limit. `validate.mjs` checks all of them (see its `Value constraints` section), and [`example/constrained`](../example/constrained.md) uses them together. <!-- id:d2OgTbaT -->

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
{ "type": "hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string",
  "minLength": 3, "maxLength": 12, "pattern": "^[a-z0-9_]+$" }
```

These constraints come from the "Seed Blob Schema v1" dialect. `validate()` reports each violation as an error string, for example `$.username: expected at least 3 characters`. The exported `validateAdvisory()` wrapper runs the same checks and is documented as **warn, don't block**: callers show its result as warnings and do not reject the write. <!-- id:u0B-Olx9 -->

## Unions <!-- id:4Zeb0ssB -->

[`anyOf`](./anyof.md) lists alternative schemas, and a value is valid if it matches **any** of them. It is the language's one composite construct. It makes the meta-schema a _[discriminated union](./discriminated-union.md)_: a value is one of a fixed set of shapes, told apart by a discriminant (here, the `type` tag). <!-- id:vsWv7IZH -->

```json <!-- id:DmjMbc7m -->
{ "anyOf": [ { "type": "schema/map-schema" }, { "type": "schema/link-schema" } ] }
```

## Generics <!-- id:Any3hnDc -->

The schema language has both kinds of [generic](./generic.md). <!-- id:GUz2-s2k -->

**Applied generics** supply a type parameter directly. `items` and `values` give them with no extra keys: <!-- id:wY_2EAUG -->
  - `list` + `items` = `List<T>`, where `items` is `T` <!-- id:aZPTtuab -->
  - `map` + `values` = `Map<V>`, where `values` is `V` <!-- id:aY249UNO -->

So `{"Apples":5,"Oranges":3}` is `Map<Integer>`, written [`example/counts`](../example/counts.md): `{ "type":"map", "values":{ "type":"integer" } }`. This nests to any depth. <!-- id:-Yhf7y6_ -->

**Generic abstraction** defines a reusable parameterized type to instantiate later. It uses three keys: <!-- id:s5ZsDksV -->

<!-- id:wD_cjjbP -->
| key <!-- col:ZdQs1aS6 --> | meaning <!-- col:qyZSsTwz --> <!-- id:J9JCB24S --> |
| --- | --- |
| `params` | declares type parameters, each with a default: `{ "params": { "B": <default> }, … }` <!-- id:lIs7tAVg --> |
| `var` | a **type-variable reference**: `{ "var": "B" }` matches whatever `B` is bound to <!-- id:5aEIR885 --> |
| `args` | **applies** a generic, binding its params: `{ "type": X, "args": { "B": <schema> } }` <!-- id:4XYh4mx3 --> |

The parameter passes through references: each level passes it down with `args`, so binding it at the top substitutes it everywhere. The worked example is [`change`](../change.md), a `Change<Block>` whose `Block` parameter flows through `change`, [`change/body`](../change/body.md), [`change/op`](../change/op.md) and [`change/op/replace-block`](../change/op/replace-block.md). Its instantiation [`example/myapp-change`](../example/myapp-change.md) is `Change<example/app-block>`, which validates blocks _strictly_ deep inside the op stack (see the `Generics: Change<Block>` checks in `validate.mjs`). A generic used bare falls back to its parameter defaults, so the common case needs no `args`. <!-- id:DcFRFUv9 -->

## How the language describes itself <!-- id:zWshFjlg -->

`schema` is a **discriminated union of nine [variants](./variant.md)**, the nine map shapes a schema can take, plus the four bare kinds a literal can be. This makes it much stricter than a loose map with optional keys: <!-- id:lI_lySSK -->

<!-- id:yZg8-sNO -->
| variant <!-- col:kO3_qHrQ --> | matches <!-- col:rCN3fgm3 --> | discriminant <!-- col:zzQn7svL --> <!-- id:4VFkvrKJ --> |
| --- | --- | --- |
| `schema/struct-schema` | `{type:"struct", properties?: {name: {value, required?, description?}}, values?}` | `type` = `struct` <!-- id:dS0FU-PD --> |
| `schema/map-schema` | `{type:"map", values?}` | `type` = `map` <!-- id:bCtL9MQx --> |
| `schema/list-schema` | `{type:"list", items?}` | `type` = `list` <!-- id:Y2gJAANc --> |
| `schema/scalar-schema` | `{type: null\|boolean\|integer\|float\|string\|bytes, …constraints}` | `type` = a scalar kind <!-- id:wkuOsUIy --> |
| `schema/link-schema` | `{type:"link", target?}` | `type` = `link` <!-- id:GXuPWZG4 --> |
| `schema/include-schema` | `{type: <another schema's URL>, …refinements?}` | `type` names a schema, not a kind <!-- id:sBVesN99 --> |
| `schema/anyof` | `{anyOf:[schema, …]}` | has `anyOf` <!-- id:uRuXGK92 --> |
| `schema/var-schema` | `{var}` | has `var` <!-- id:nw86Dhqn --> |
| `schema/literal-schema` | `{value, description?}` | has `value` <!-- id:Lit5eral --> |
| [string](../string.md), [integer](../integer.md), [boolean](../boolean.md), [null](../null.md) | a bare value | is not a map <!-- id:Lit6eral --> |

Each variant is a **closed** map, so a nonsense schema like `{type:"string", items:{…}}` matches _none_ of them. The closed `schema/scalar-schema` rejects the stray `items` key, and the `type` tag rules out the others. Run it: <!-- id:j-_t0aVk -->

```sh <!-- id:yezLjFqJ -->
node scripts/hypermedia/validate.mjs
#   ok   scalar carrying `items` (rejected)
```

### The loop still closes <!-- id:cAg3Oszt -->

`schema` is `{ "anyOf": [ …thirteen includes… ] }`. Validate it against itself: <!-- id:Gjr5KNDl -->
  1. It matches the **`schema/anyof`** variant, because it has an `anyOf` that is a list of schemas. <!-- id:deE1RQMk -->
  2. Each item in that `anyOf` is a bare `{type: …}` naming a variant schema, which matches the **`schema/include-schema`** variant. <!-- id:yYBUIRiY -->
  3. Each variant file (e.g. `schema/map-schema`) is itself a `{type:"struct", …}`, which matches the **`schema/struct-schema`** variant. <!-- id:3RbdlEZc -->

The meta-schema is a union with a union variant among its variants, and it validates as that variant. This is its [self-description](./self-description.md). <!-- id:pUf5EFPl -->

Nothing defines the string `"map"`. A variant pins `type` to the literal kind URL (`schema/map-schema` says `type: {value: "hm://…/map"}`), and the scalar variant lists its six kinds as a union of literals. `string`, `link`, and `bytes` get no special treatment there: the language names kinds and does not define them. <!-- id:8YmU20RL -->

## The proof is executable <!-- id:pnI1No8b -->

`validate.mjs` validates `schema` against itself and every variant against the union. It also confirms the union _rejects_ malformed schemas. You can run it: <!-- id:R4Z6LPtc -->

```sh <!-- id:PxteeEDG -->
node scripts/hypermedia/validate.mjs
#   ok   hypermedia-schema.schema.json describes itself
#   ...
#   ok   schema/map-schema.schema.json
#   ...
#   ok   scalar carrying `items` (rejected)
```

If you extend the vocabulary, run it again. If the union can no longer describe its own new shape, the loop is broken and the check fails. <!-- id:vGjbVugA -->

# See also <!-- id:JD7jplmC -->

- [Hypermedia Schemas](../schema.md): the meta-schema and the index of schema pages. <!-- id:VToSvCAu -->
- [The data model](./data-model.md): the nine kinds every value is built from. <!-- id:EkRaa876 -->
- [References and naming](./references.md): include, typed link, and why references are `hm://` names. <!-- id:ewBSSZpE -->
- [Encoding](./encoding.md): how a schema becomes canonical DAG-CBOR. <!-- id:qqYp_kau -->
- [Typed documents](./typed-documents.md): how a document names its schema. <!-- id:wVgYa0nh -->
- [Quick reference](./quick-reference.md): the whole system on one page. <!-- id:FfOecpJs -->
- [Examples](../example.md): every example schema, grouped by feature. <!-- id:pI6ZGF0E -->
