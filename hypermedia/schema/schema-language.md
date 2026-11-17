---
name: Schema Language
summary: This page lists every key you can write in a schema, and shows structs, maps, unions, generics, extension and how the meta-schema checks itself.
---
The schema language is the set of keys you use to write a [Hypermedia schema](../schema.md). A schema is a map. You build it from **twelve keys**, and every key is optional. Ten keys say what shape the data has. Two keys, `name` and `description`, are notes for people. A few more keys set limits on a single value, such as a shortest length. They are listed under [Value constraints](#DVRwHp1m).

A schema can also be a **literal**: a bare `null`, boolean, integer or string. A literal accepts exactly that one value. That is the whole language, and this page describes all of it. <!-- id:EXSoVP3S -->

<!-- id:7guJrYQy -->
| key <!-- col:PPQxsZds --> | applies to <!-- col:arAp45HF --> | meaning <!-- col:OMQjDwG3 --> <!-- id:lyC-RqMi --> |
| --- | --- | --- |
| `type` | any | what this node **is**: an `hm://` URL naming one of the nine [kinds](./kind.md) or `struct` (see [the data model](./data-model.md)), or naming another schema (see [references](./references.md)) <!-- id:hwpC2KX7 --> |
| `properties` | `struct` | a map from each known field name to its [property](./property.md) <!-- id:InbInGwv --> |
| `items` | `list` | schema every element must match <!-- id:GxgxLBO8 --> |
| `values` | `map`, `struct` | schema every _value_ must match <!-- id:lBxL68T_ --> |
| `value` | literal | the one value a literal schema accepts, when the literal needs a `description` (see below) <!-- id:Jh3SOAp5 --> |
| `target` | `link`, reference string | the schema that the thing pointed at should match (see [references](./references.md)) <!-- id:8kpIEN7j --> |
| `anyOf` | any | a **union**: the value must match one of the listed schemas <!-- id:Ww-tAztO --> |
| `params` | any map variant except a literal or a variable | declares type parameters (generics), each with a default <!-- id:LmVM4b91 --> |
| `var` | a variable | a reference to a type parameter: `{ "var": "B" }` <!-- id:MeJc4pL2 --> |
| `args` | reference | applies a generic, binding its parameters <!-- id:CAIxcz9j --> |
| `name` | any map variant except a literal | a name some older schemas carry. New schemas are named by their page. Ignored when validating data <!-- id:vCbTeSgE --> |
| `description` | any | a description for people. Ignored when validating data <!-- id:hv4WT6n0 --> |

`name` and `description` are **metadata** about the schema. The validator ignores them when it checks a value. The [Schema view](./workflows.md#AMFjgZzp) shows `description` under the title. The title is the name of the page that defines the schema, so a new schema does not need `name`. A schema's `name` has nothing to do with a field called `name` inside its `properties`. <!-- id:GROkvj0R -->

A `type` value is a URL. It is an [`hm://` URL](../protocol/urls.md) when it names a kind or a named schema, so every type is clickable. It can also be `ipfs://<cid>` to name one exact schema blob (see [references](./references.md)). The real value for a map is `"hm://hyper.media/map"`. **In running text and tables, these pages shorten `hm://hyper.media/map` to `map`.** Examples use the same library name: `example/person` is `hm://hyper.media/example/person`. Code blocks show the full URL, because that is what you write in a real schema. <!-- id:SZ-BjsVR -->

# Literals <!-- id:Lit1eral -->

A **[literal](./literal-schema.md)** schema accepts exactly one value. You write it as that value: `"draft"`, `1`, `true`, `null`. A literal can be a string, an integer, a boolean or null. Together these four are the [value](../value.md) union. A literal can never be a float, a map or a list.

A union of literals limits a field to a fixed set of choices. Each choice can carry a description in the long form `{value, description}`: <!-- id:Lit2eral -->

```json <!-- id:Lit3eral -->
// a status field: one of three values, one of them explained
"status": { "value": { "anyOf": [
  "draft",
  { "value": "published", "description": "Visible to everyone" },
  "archived"
] } }

// a tag field pinned to one value: the whole schema is the literal
"type": { "value": "Change", "required": true }
```

Every signed [blob](../protocol/blobs.md) type pins its `type` this way. In TypeScript these become literal types (`type: 'Change'`, `'draft' | 'published' | 'archived'`). <!-- id:Lit4eral -->

One rule covers the whole language: **`type` names what a node is, and every other key refines what it names.** A node is one schema, at any depth inside a larger schema.

- If `type` names a kind, or `struct`, the schema is grounded there.
- If `type` names _another schema_, the node is an **[include](./include-schema.md)**. With nothing else on the node, it becomes whatever that schema says.
- Add a refinement and the include becomes an **[extension](./extension.md)** (below). On a node that names another schema, the refinements the meta-schema allows are `properties`, `values`, `items` and `target`.
- To add `pattern`, `minLength` or another value constraint, write the constraint on a node whose `type` is the kind itself.
- A node with `type:"link"` and a `target` is a **typed [link](../link.md)**: a link whose target should match the named schema. <!-- id:wxGU9ndD -->

# Extension (subtyping) <!-- id:go7Qda14 -->

A node **extends** another schema when its `type` names that schema and it _also_ carries refinements. The result is a subtype: it has the parent's fields plus new ones. The worked example is [`example/employee`](../example/employee.md), which extends `example/person`: <!-- id:c6VcyJfa -->

```json <!-- id:fnvdYhmQ -->
// example/employee = example/person, plus employeeId and department
{
  "type": "hm://hyper.media/example/person",
  "properties": {
    "employeeId": { "value": { "type": "hm://hyper.media/string" }, "required": true },
    "department": { "value": { "type": "hm://hyper.media/string" } }
  }
}
```

Open `example/employee` in the Schema view to see the merged result. It marks every field _inherited_ or _added_. <!-- id:rBtaiBHO -->

The rules use keys the language already has, so there is no `extends` keyword: <!-- id:A9LrCpUD -->
  - `properties` are **merged**: the parent's plus the extension's. When both name the same field, the extension's entry replaces the parent's. Each entry is a [property](./property.md), so a field's required flag travels with it. <!-- id:Zkb8fXkn -->
  - `values` or `items` on the extension replace the parent's. <!-- id:jK0_muct -->
  - The result keeps the parent's kind, and stays closed if the parent is closed. An employee must have `name` (required on the parent) **and** `employeeId` (required on the extension). It may use any inherited field, and it still rejects unknown keys. <!-- id:jmFaI8J0 -->

A **bare** `{ "type": X }`, where X names another schema and the node has nothing else, is a plain include. It becomes an extension only when it has a refinement. An extension can also pin an inherited field to a literal. <!-- id:QzURq80i -->

# Structs and maps <!-- id:SFVk1Mph -->

A [`struct`](../struct.md) names its fields in `properties`, one [property](./property.md) per field. `properties[name]` is `{value, required?, description?}`:

- `value` is the schema the field's value must match.
- `required` says whether the data must include the field.
- `description` says what the field is for.

A struct is **[closed](./closed-map.md)**, so it rejects keys that are not listed. Add `values` and it is open: extra keys are allowed when their values match the `values` schema. A [`map`](../map.md) has no named fields, and the value of every key matches `values`. So: <!-- id:8FWAU877 -->
  - `struct` with `properties` and no `values` is a **closed struct**: a fixed set of fields <!-- id:AjvS967n -->
  - `map` with `values` is a **map**: any keys, one type for every value <!-- id:e1GSoOu5 -->
  - `struct` with both has known fields in `properties`, and everything else must match `values` <!-- id:3wP9hZuQ -->
  - a bare `map` or `struct` accepts any map <!-- id:0R9RPaBS -->

```json <!-- id:KIYtikI2 -->
// closed struct: {name, age} and nothing else
{ "type": "hm://hyper.media/struct",
  "properties": {
    "name": { "value": { "type": "hm://hyper.media/string" }, "required": true, "description": "Full name" },
    "age":  { "value": { "type": "hm://hyper.media/integer" } } } }
```

```json <!-- id:uOkzD_Gb -->
// open map: arbitrary keys, integer values
{ "type": "hm://hyper.media/map", "values": { "type": "hm://hyper.media/integer" } }
```

Because structs are closed, the meta-schema can _reject_ a broken schema that has extra keys (see below). <!-- id:bP4jTzqq -->

# Value constraints <!-- id:DVRwHp1m -->

A schema can also limit the _values_ a single string, number or list accepts. Every constraint is optional. A missing constraint means no limit. [`example/constrained`](../example/constrained.md) uses them together. <!-- id:d2OgTbaT -->

<!-- id:ePFO5CZ6 -->
| key <!-- col:LGrl5hdK --> | applies to <!-- col:SZYGj3li --> | meaning <!-- col:X_e0Bwsx --> <!-- id:FJBhhPv1 --> |
| --- | --- | --- |
| `minLength` | `string` | shortest length, counted in **code points** <!-- id:eTvANQ7B --> |
| `maxLength` | `string` | longest length, counted in **code points** <!-- id:NHnyTLTT --> |
| `pattern` | `string` | an ECMAScript regular expression the value must match. It is **unanchored**: it can match any part of the string unless you write `^` and `$`. A pattern that does not compile is ignored <!-- id:ft1VaQeN --> |
| `minimum` | `integer` / `float` | value must be ≥ this number. The bound itself must be a whole number <!-- id:CM8SZUXN --> |
| `maximum` | `integer` / `float` | value must be ≤ this number. The bound itself must be a whole number <!-- id:pBOqKr74 --> |
| `minItems` | `list` | smallest number of elements <!-- id:y_OlIa-N --> |
| `maxItems` | `list` | largest number of elements <!-- id:f6qBJIXh --> |
| `format` | `string` | a hint for editors and renderers. The value is still a plain string. One of: `date`, `date-time`, `url`, `hm-url`, `ipfs-url` or `hm-profile` |

```json <!-- id:RBAU34K6 -->
// a lowercase handle, 3–12 code points, matching a pattern
{ "type": "hm://hyper.media/string",
  "minLength": 3, "maxLength": 12, "pattern": "^[a-z0-9_]+$" }
```

The library has six ready-made strings, and each one fixes one format: [date](../date.md), [date-time](../date-time.md), [url](../url.md), [hm-url](../hm-url.md), [ipfs-url](../ipfs-url.md) and [account](../account.md).

`validate()` reports each broken rule as an error string, for example `$.username: expected at least 3 characters`. `validateAdvisory()` runs the same checks. Its rule is **warn, do not block**: a caller shows the result as warnings and does not refuse the write. <!-- id:u0B-Olx9 -->

# Unions <!-- id:4Zeb0ssB -->

[`anyOf`](./anyof.md) lists several schemas. A value is valid if it matches **any** one of them. This is the only way the language combines schemas. The [meta-schema](../schema.md) uses it to be a _[discriminated union](./discriminated-union.md)_: a value is one of a fixed set of shapes, and one mark tells them apart. Here that mark is the `type` tag. <!-- id:vsWv7IZH -->

```json <!-- id:DmjMbc7m -->
{ "anyOf": [ { "type": "hm://hyper.media/schema/map-schema" }, { "type": "hm://hyper.media/schema/link-schema" } ] }
```

# Generics <!-- id:Any3hnDc -->

A [generic](./generic.md) is a type with a blank that another type fills in. The schema language has two forms. <!-- id:GUz2-s2k -->

**Applied generics** fill in the type at once. `items` and `values` do this with no extra keys: <!-- id:wY_2EAUG -->
  - `list` + `items` = `List<T>`, where `items` is `T` <!-- id:aZPTtuab -->
  - `map` + `values` = `Map<V>`, where `values` is `V` <!-- id:aY249UNO -->

So `{"Apples":5,"Oranges":3}` is `Map<Integer>`, written [`example/counts`](../example/counts.md): `{ "type":"map", "values":{ "type":"integer" } }`. You can nest these to any depth. <!-- id:-Yhf7y6_ -->

**Generic abstraction** defines a type with named parameters, to fill in later. It uses three keys: <!-- id:s5ZsDksV -->

<!-- id:wD_cjjbP -->
| key <!-- col:ZdQs1aS6 --> | meaning <!-- col:qyZSsTwz --> <!-- id:J9JCB24S --> |
| --- | --- |
| `params` | declares type parameters, each with a default: `{ "params": { "B": <default> }, … }` <!-- id:lIs7tAVg --> |
| `var` | a **reference to a type parameter**: `{ "var": "B" }` matches whatever `B` is bound to <!-- id:5aEIR885 --> |
| `args` | **applies** a generic, binding its params: `{ "type": X, "args": { "B": <schema> } }` <!-- id:4XYh4mx3 --> |

A parameter passes through references. Each level hands it down with `args`, so binding it at the top fills it in everywhere. The worked example is [`change`](../change.md), a `Change<Block>`. Its `Block` parameter flows through `change`, [`change/body`](../change/body.md), [`change/op`](../change/op.md) and [`change/op/replace-block`](../change/op/replace-block.md). [`example/myapp-change`](../example/myapp-change.md) fills it in as `Change<example/app-block>`, so [blocks](../protocol/blocks.md) deep inside the list of ops are checked _strictly_. A generic used with no `args` falls back to the defaults of its parameters, so the common case needs no `args`. <!-- id:DcFRFUv9 -->

# How the language describes itself <!-- id:zWshFjlg -->

The meta-schema, named `schema`, is a **discriminated union**. It has nine [variants](./variant.md), the nine map shapes a schema can take, plus the four bare kinds a literal can be. This is much stricter than one loose map with optional keys: <!-- id:lI_lySSK -->

<!-- id:yZg8-sNO -->
| variant <!-- col:kO3_qHrQ --> | matches <!-- col:rCN3fgm3 --> | discriminant <!-- col:zzQn7svL --> <!-- id:4VFkvrKJ --> |
| --- | --- | --- |
| [`schema/struct-schema`](./struct-schema.md) | `{type:"struct", properties?: {name: {value, required?, description?}}, values?}` | `type` = `struct` <!-- id:dS0FU-PD --> |
| [`schema/map-schema`](./map-schema.md) | `{type:"map", values?}` | `type` = `map` <!-- id:bCtL9MQx --> |
| [`schema/list-schema`](./list-schema.md) | `{type:"list", items?}` | `type` = `list` <!-- id:Y2gJAANc --> |
| [`schema/scalar-schema`](./scalar-schema.md) | `{type: null\|boolean\|integer\|float\|string\|bytes, …constraints}` | `type` = a scalar kind <!-- id:wkuOsUIy --> |
| [`schema/link-schema`](./link-schema.md) | `{type:"link", target?}` | `type` = `link` <!-- id:GXuPWZG4 --> |
| [`schema/include-schema`](./include-schema.md) | `{type: <another schema's URL>, …refinements?}` | `type` names a schema, not a kind <!-- id:sBVesN99 --> |
| [`schema/anyof`](./anyof.md) | `{anyOf:[schema, …]}` | has `anyOf` <!-- id:uRuXGK92 --> |
| [`schema/var-schema`](./var-schema.md) | `{var}` | has `var` <!-- id:nw86Dhqn --> |
| [`schema/literal-schema`](./literal-schema.md) | `{value, description?}` | has `value` <!-- id:Lit5eral --> |
| [string](../string.md), [integer](../integer.md), [boolean](../boolean.md), [null](../null.md) | a bare value | is not a map <!-- id:Lit6eral --> |

Each variant is a **closed** struct. So a broken schema such as `{type:"string", items:{…}}` matches _none_ of them. `schema/scalar-schema` is closed and rejects the extra `items` key. The `type` tag rules out the other variants. <!-- id:j-_t0aVk -->

## The meta-schema checks itself <!-- id:cAg3Oszt -->

`schema` is `{ "anyOf": [ …thirteen includes… ] }`. Check it against itself: <!-- id:Gjr5KNDl -->
  1. It matches the **`schema/anyof`** variant, because it has an `anyOf` that is a list of schemas. <!-- id:deE1RQMk -->
  2. Each item in that `anyOf` is a bare `{type: …}` naming a variant schema, which matches the **`schema/include-schema`** variant. <!-- id:yYBUIRiY -->
  3. Each variant file, such as `schema/map-schema`, is itself a `{type:"struct", …}`, which matches the **`schema/struct-schema`** variant. <!-- id:3RbdlEZc -->

So the meta-schema is a union, one of its own variants describes a union, and it passes as that variant. This is its [self-description](./self-description.md). <!-- id:pUf5EFPl -->

Nothing defines the string `"map"`. A variant pins `type` to the kind's URL as a literal: `schema/map-schema` says `type: {value: "hm://…/map"}`. The scalar variant lists its six kinds as a union of literals. `string`, `link` and `bytes` get no special treatment there. The language names kinds and does not define them. <!-- id:8YmU20RL -->

The reference validator runs this check on the library. [The library pipeline](./library-pipeline.md) describes how. <!-- id:R4Z6LPtc -->

# See also <!-- id:JD7jplmC -->

- [Hypermedia Schemas](../schema.md): the meta-schema and the index of schema pages. <!-- id:VToSvCAu -->
- [The data model](./data-model.md): the nine kinds every value is built from. <!-- id:EkRaa876 -->
- [References and naming](./references.md): include, typed link, and why references are `hm://` names. <!-- id:ewBSSZpE -->
- [Encoding](./encoding.md): how a schema becomes canonical [DAG-CBOR](./dag-cbor.md). <!-- id:qqYp_kau -->
- [Typed documents](./typed-documents.md): how a [document](../protocol/documents.md) names its schema. <!-- id:wVgYa0nh -->
- [The catalogue of types](./types.md): every type in the library. <!-- id:FfOecpJs -->
- [The rationale](./why.md): why the language has this shape.
- [Examples](../example.md): every example schema, grouped by feature. <!-- id:pI6ZGF0E -->
