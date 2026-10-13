// Reference validator for Hypermedia schemas.
//
//   node validate.mjs                  -> self-description proof + example checks
//   node validate.mjs <schema> <data>  -> validate a JSON data file against a schema
//
// Hypermedia data model (9 kinds): null, boolean, integer, float, string, bytes,
// list, map, link. In human/dag-json form, a link is {"/":"<cid>"} and bytes
// is {"/":{"bytes":"<base64>"}} -- both are distinct kinds, NOT maps.
//
// Schema vocabulary: type, properties, items, values, target, anyOf, allOf, and
// literals (a bare scalar, or {value, description}).
//   - a literal                 -> the value must equal it; {anyOf: ["a","b"]} is a fixed set.
//   - `anyOf`                   -> union: value must match one of the variants.
//   - `allOf`                   -> intersection: the struct arms MERGE into one struct (fields
//                                  united, required if any arm requires, closed if any arm is).
//   - `type` naming a schema    -> include: defer to that schema file; other keys refine it.
//   - `type:"link"` + `target`  -> typed link: the linked block should match that schema
//                                  (checked lazily, not here).
//   - a `map` with `properties` and no `values` is CLOSED: unknown keys are
//     rejected. With `values`, extra keys must match the `values` schema.

import { existsSync, readFileSync } from "node:fs";
import { HM_DIR, listSchemaFiles, refToName, fileOfName } from "./names.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = HM_DIR;

// References are hm://hyper.media/<name> URLs, where the name is the schema's path in hypermedia/
// (string, schema, example/person, …).
const LIBRARY_AUTHORITY = "hyper.media";
const urlToFile = (ref) => fileOfName(refToName(ref, (name) => existsSync(resolve(DIR, fileOfName(name)))));

const cache = new Map();
export const load = (ref) => {
  const file = urlToFile(ref); // accepts an hm:// URL or a bare filename
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(resolve(DIR, file), "utf8")));
  return cache.get(file);
};

// --- kind detection (dag-json envelopes are their own kinds) -----------

const isLink = (d) =>
  d && typeof d === "object" && !Array.isArray(d) &&
  Object.keys(d).length === 1 && typeof d["/"] === "string";

const isBytes = (d) =>
  d && typeof d === "object" && !Array.isArray(d) &&
  Object.keys(d).length === 1 && d["/"] && typeof d["/"] === "object" &&
  Object.keys(d["/"]).length === 1 && typeof d["/"].bytes === "string";

function typeOf(d) {
  if (d === null) return "null";
  if (Array.isArray(d)) return "list";
  if (typeof d === "object") return isLink(d) ? "link" : isBytes(d) ? "bytes" : "map";
  if (typeof d === "number") return Number.isInteger(d) ? "integer" : "float";
  return typeof d; // string, boolean
}

// A `type` value is a kind URL (hm://hyper.media/<kind>); read the kind locally off
// the URL — no fetch needed, so the discriminant stays local.
const KINDS = ["null", "boolean", "integer", "float", "string", "bytes", "list", "map", "struct", "link"];
const KIND_URL = new RegExp(`^hm://hyper\\.media/([a-z]+)$`);
const kindOf = (t) => {
  const k = KIND_URL.exec(t)?.[1];
  return k && KINDS.includes(k) ? k : t;
};

function typeMatches(type, d) {
  switch (type) {
    case "null": return d === null;
    case "boolean": return typeof d === "boolean";
    case "integer": return typeof d === "number" && Number.isInteger(d);
    case "float": return typeof d === "number"; // JSON can't distinguish 3.0 from 3
    case "string": return typeof d === "string";
    case "bytes": return isBytes(d);
    case "list": return Array.isArray(d);
    case "map": case "struct": return typeOf(d) === "map";
    case "link": return isLink(d);
    default: return false;
  }
}

// A node refines the schema it names when it carries any of these: structural keys and leaf
// refinements alike, so `{type: <url>, format: "ipfs-url"}` narrows a leaf exactly as
// `{type: <url>, properties: {…}}` extends a struct.
const REFINE = [
  "properties",
  "values",
  "items",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "target",
];

// The schema a node NAMES rather than grounding in a kind: `type` holding any schema URL that is
// not one of the nine kinds. `ref` is the older spelling of the same thing and still resolves.
export const namedSchemaUrl = (schema) => {
  if (typeof schema.type === "string") return kindOf(schema.type) === schema.type ? schema.type : null;
  return typeof schema.ref === "string" ? schema.ref : null;
};

// A literal schema accepts exactly one value: a bare scalar (null, boolean,
// integer, float, string) or, with a description, {value, description}.
export const isLiteralSchema = (s) => {
  if (s === undefined) return false;
  if (s === null || typeof s !== "object") return true;
  if (Array.isArray(s)) return false;
  return "value" in s && !("type" in s || "ref" in s || "anyOf" in s || "allOf" in s || "var" in s || "params" in s);
};
export const literalValue = (s) => (s !== null && typeof s === "object" ? s.value : s);
const literalNode = (s) => (s !== null && typeof s === "object" ? s : { value: s });

// A struct writes its fields as `properties[name] = {value, required?, description?}`.
// (A literal schema is also spelled {value}, but a properties entry always wraps
// its field's schema, so there `value` IS the field's schema.)
export function structFields(schema) {
  if (!schema || !schema.properties || typeof schema.properties !== "object") return [];
  return Object.entries(schema.properties).map(([name, entry]) => ({
    name,
    schema: entry?.value === undefined ? {} : entry.value,
    required: entry?.required === true,
    description: entry?.description,
  }));
}
export function fieldSchema(schema, name) {
  const entry = schema?.properties?.[name];
  if (entry === undefined) return undefined;
  return entry?.value === undefined ? {} : entry.value;
}
export function fieldsToProperties(fields) {
  const out = {};
  for (const f of fields) {
    const e = { value: f.schema };
    if (f.required) e.required = true;
    if (f.description) e.description = f.description;
    out[f.name] = e;
  }
  return out;
}

// Merge an extension node's refinements over its (already-resolved) parent — a
// subtype: parent's fields plus the new ones (an extension may override a field).
export function mergeExtend(parent, ext) {
  const merged = { type: parent.type };
  const byName = new Map();
  for (const f of structFields(parent)) byName.set(f.name, f);
  for (const f of structFields(ext)) byName.set(f.name, f);
  if (byName.size) merged.properties = fieldsToProperties([...byName.values()]);
  const values = ext.values ?? parent.values;
  if (values) merged.values = values;
  const items = ext.items ?? parent.items;
  if (items) merged.items = items;
  // Leaf refinements are inherited by a subtype (a `{type: date, …}` stays a
  // date; `{type: ipfs-url, target}` keeps its format and gains a target).
  for (const k of LEAF_KEYS) {
    const v = ext[k] ?? parent[k];
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

// Refinements that describe a leaf value or a reference; inherited through extension.
const LEAF_KEYS = ["format", "pattern", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "target"];

// Merge the (already-resolved) arms of an `allOf` into one struct — an intersection written as a
// merge, the way extension already is, so two closed structs combine instead of contradicting each
// other (a value cannot satisfy two closed field sets at once, so validating against each arm in
// turn would accept nothing). Every arm must resolve to a struct or map; the fields are united; a
// field is required when any arm requires it; a field two arms define must be defined the same
// way; the result is closed when any arm is closed, and otherwise keeps the arms' shared `values`.
// Returns {__invalid: reason} for arms that cannot be merged.
export function mergeAllOf(arms) {
  const byName = new Map();
  let closed = false;
  let isStruct = false;
  let values;
  for (const [i, arm] of arms.entries()) {
    if (arm.__unbound || arm.__missing || arm.__invalid) return arm;
    const kind = arm.type ? kindOf(arm.type) : null;
    if (isLiteralSchema(arm) || arm.anyOf || (kind !== "map" && kind !== "struct"))
      return { __invalid: `allOf arm ${i + 1} is not a struct or map` };
    if (kind === "struct" || arm.properties) isStruct = true;
    for (const f of structFields(arm)) {
      const prior = byName.get(f.name);
      if (prior && !deepEqual(prior.schema, f.schema))
        return { __invalid: `allOf arms define the field "${f.name}" differently` };
      byName.set(f.name, {
        name: f.name,
        schema: f.schema,
        required: (prior?.required ?? false) || f.required,
        description: prior?.description ?? f.description,
      });
    }
    if (arm.properties && !arm.values) closed = true;
    else if (arm.values !== undefined) {
      if (values !== undefined && !deepEqual(values, arm.values))
        return { __invalid: "allOf arms constrain extra keys (`values`) differently" };
      values = arm.values;
    }
  }
  const merged = { type: `hm://${LIBRARY_AUTHORITY}/${isStruct ? "struct" : "map"}` };
  if (byName.size) merged.properties = fieldsToProperties([...byName.values()]);
  if (!closed && values !== undefined) merged.values = values;
  return merged;
}

// Resolve a node to a concrete schema (map/list/scalar/link/union), following:
//   var    -> the schema bound to a type parameter        {var:"B"}
//   params -> a generic definition; binds defaults        {params:{B:default}, …}
//   type+args   -> APPLICATION: instantiate a generic     {type:X, args:{B:…}}
//   type+refine -> EXTENSION: subtype of X                {type:X, properties:…}
//   type (bare) -> include: conforms to X                 {type:X}
//   allOf       -> INTERSECTION: the struct arms merged   {allOf:[{type:A},{type:B}]}
// `env` binds type variables. Returns { schema, env } for the resolved node.
export function resolveSchema(schema, env = {}) {
  if (isLiteralSchema(schema)) return { schema: literalNode(schema), env };
  if (schema.params) {
    const penv = { ...env };
    for (const [p, def] of Object.entries(schema.params)) if (penv[p] === undefined) penv[p] = def;
    const { params, ...body } = schema;
    return resolveSchema(body, penv);
  }
  if (schema.var !== undefined) {
    const bound = env[schema.var];
    if (bound === undefined) return { schema: { __unbound: schema.var }, env: {} };
    return resolveSchema(bound, {});
  }
  if (Array.isArray(schema.allOf)) {
    if (schema.allOf.length === 0) return { schema: { __invalid: "allOf needs at least one arm" }, env };
    return { schema: mergeAllOf(schema.allOf.map((arm) => resolveSchema(arm, env).schema)), env };
  }
  const named = namedSchemaUrl(schema);
  if (named && schema.anyOf === undefined) {
    const target = load(named);
    if (schema.args) {
      const argsEnv = {};
      for (const [k, v] of Object.entries(schema.args)) argsEnv[k] = v && v.var !== undefined ? env[v.var] : v;
      return resolveSchema(target, argsEnv); // application: fresh env from args
    }
    const parent = resolveSchema(target, env);
    if (REFINE.some((k) => schema[k] !== undefined)) {
      if (parent.schema.anyOf || parent.schema.__unbound) return parent; // can't extend a union/var
      return { schema: mergeExtend(parent.schema, schema), env: parent.env };
    }
    return parent;
  }
  return { schema, env };
}

// Returns a list of error strings. Empty == valid. `env` binds type variables.
export function validate(schema0, data, path = "$", env0 = {}) {
  const { schema, env } = resolveSchema(schema0, env0);

  if (schema.__unbound) return [`${path}: unbound type variable "${schema.__unbound}"`];
  if (schema.__invalid) return [`${path}: ${schema.__invalid}`];

  // literal: the value must equal it.
  if (isLiteralSchema(schema))
    return deepEqual(schema.value, data) ? [] : [`${path}: expected ${JSON.stringify(schema.value)}, got ${JSON.stringify(data)}`];

  // union: matches if it matches any variant.
  if (schema.anyOf) {
    if (schema.anyOf.length === 0) return [`${path}: no value matches an empty union (none)`];
    const attempts = schema.anyOf.map((v) => validate(v, data, path, env));
    if (attempts.some((e) => e.length === 0)) return [];
    const topLevel = (errs) => errs.some((e) => e.startsWith(`${path}: expected`));
    const best = attempts.slice().sort((a, b) => topLevel(a) - topLevel(b) || a.length - b.length)[0];
    return [`${path}: matches none of the ${schema.anyOf.length} variants`, ...best];
  }

  const errors = [];
  const kind = schema.type ? kindOf(schema.type) : null;
  if (kind && !typeMatches(kind, data)) {
    errors.push(`${path}: expected ${kind}, got ${typeOf(data)}`);
    return errors;
  }
  if (kind === "map" || kind === "struct") {
    for (const f of structFields(schema)) if (f.required && !(f.name in data)) errors.push(`${path}: missing required "${f.name}"`);
    const closed = schema.properties && !schema.values;
    for (const [key, value] of Object.entries(data)) {
      const child = fieldSchema(schema, key) ?? schema.values;
      if (child) errors.push(...validate(child, value, `${path}.${key}`, env));
      else if (closed) errors.push(`${path}: unexpected key "${key}"`);
    }
  }
  if (kind === "list") {
    if (schema.items) data.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`, env)));
    if (typeof schema.minItems === "number" && data.length < schema.minItems)
      errors.push(`${path}: expected at least ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems)
      errors.push(`${path}: expected at most ${schema.maxItems} items`);
  }
  if (kind === "string") {
    const len = [...data].length; // code points, not UTF-16 units
    if (typeof schema.minLength === "number" && len < schema.minLength)
      errors.push(`${path}: expected at least ${schema.minLength} characters`);
    if (typeof schema.maxLength === "number" && len > schema.maxLength)
      errors.push(`${path}: expected at most ${schema.maxLength} characters`);
    if (typeof schema.pattern === "string") {
      let re = null;
      try { re = new RegExp(schema.pattern); } catch { re = null; } // uncompilable pattern is ignored
      if (re && !re.test(data))
        errors.push(
          typeof schema.format === "string"
            ? `${path}: does not match pattern for format "${schema.format}"`
            : `${path}: does not match pattern`,
        );
    }
  }
  if (kind === "integer" || kind === "float") {
    if (typeof schema.minimum === "number" && data < schema.minimum)
      errors.push(`${path}: expected a value >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && data > schema.maximum)
      errors.push(`${path}: expected a value <= ${schema.maximum}`);
  }

  return errors;
}

// Advisory (warn-don't-block) validation: identical checks to validate(), but the
// returned error array is meant to be surfaced as warnings, not to block a write.
// validate() already returns an array and never throws, so this is a thin,
// intention-revealing wrapper.
export function validateAdvisory(schema, data, path = "$", env = {}) {
  return validate(schema, data, path, env);
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- CLI / self-test — only when run directly, not when imported -------

const RUN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (RUN) {
const [, , schemaArg, dataArg] = process.argv;

if (schemaArg && dataArg) {
  const errors = validate(load(schemaArg), JSON.parse(readFileSync(dataArg, "utf8")));
  report(`${dataArg} against ${schemaArg}`, errors);
  process.exit(errors.length ? 1 : 0);
}

let failed = 0;
const meta = load("schema.schema.json");

// dag-json constructors for test data
const cid = (s) => ({ "/": s });
const bytes = (b) => ({ "/": { bytes: b } });

// =====================================================================
// 1. Self-description — the meta-schema is a valid instance of itself.
// =====================================================================
section("Self-description");
failed += report("schema.schema.json describes itself", validate(meta, meta));

// =====================================================================
// 2. Every schema block in the directory is a valid Hypermedia schema.
//    Auto-discovered, so new examples are covered without editing tests.
// =====================================================================
section("Every schema block is a valid Hypermedia schema");
const jsonFiles = listSchemaFiles();
for (const f of jsonFiles) {
  failed += report(`${f}`, validate(meta, load(f)));
}

// =====================================================================
// 3. The discriminated union REJECTS malformed schemas.
// =====================================================================
section("The meta-schema rejects malformed schemas");
const K = (k) => `hm://${LIBRARY_AUTHORITY}/${k}`;
failed += reportReject("scalar carrying `items`", validate(meta, { type: K("string"), items: { type: K("integer") } }));
failed += reportReject("scalar carrying `properties`", validate(meta, { type: K("string"), properties: {} }));
failed += reportReject("map schema with an unknown keyword", validate(meta, { type: K("map"), bogus: 1 }));
failed += reportReject("struct schema with an unknown keyword", validate(meta, { type: K("struct"), bogus: 1 }));
const U = (k) => `hm://${LIBRARY_AUTHORITY}/${k}`;
failed += report("a struct with fields is a valid schema", validate(meta, { type: U("struct"), properties: { a: { value: { type: U("string") }, required: true, description: "an a" } } }));
failed += reportReject("a struct field must be a property ({value, …}), not a bare schema", validate(meta, { type: U("struct"), properties: { a: { type: U("string") } } }));
failed += report("a map of values is a valid schema", validate(meta, { type: U("map"), values: { type: U("integer") } }));
failed += reportReject("a map with named fields (that is a struct)", validate(meta, { type: U("map"), properties: { a: { value: { type: U("string") } } } }));
failed += reportReject("a struct with a `required` list (fields carry their own flag)", validate(meta, { type: U("struct"), required: ["a"], properties: { a: { value: { type: U("string") } } } }));
failed += reportReject("node with neither type nor anyOf", validate(meta, { properties: {} }));
failed += reportReject("union with a non-schema arm", validate(meta, { anyOf: [{ nope: 1 }] }));
failed += reportReject("bare kind name instead of a URL", validate(meta, { type: "string" }));

// Literals: a bare scalar is a schema; so is {value, description}. Anything
// else spelled with `value` is not, and a literal can only be a scalar.
section("Literal schemas");
failed += report("a bare string is a schema", validate(meta, "draft"));
failed += report("a bare integer is a schema", validate(meta, 1));
failed += report("a bare boolean is a schema", validate(meta, true));
failed += report("null is a schema", validate(meta, null));
failed += report("a described literal is a schema", validate(meta, { value: "draft", description: "Not yet published" }));
failed += report("a union of literals is a schema", validate(meta, { anyOf: ["draft", { value: "published", description: "Live" }, 1, null] }));
failed += reportReject("a float is not a literal", validate(meta, 1.5));
failed += reportReject("a map is not a literal", validate(meta, { value: { a: 1 } }));
failed += reportReject("a list is not a literal", validate(meta, { value: [1] }));
failed += reportReject("a literal carrying a schema key", validate(meta, { value: "x", type: U("string") }));
failed += reportReject("a literal with an unknown key", validate(meta, { value: "x", bogus: 1 }));
failed += report("a struct field pinned to a literal", validate(meta, { type: U("struct"), properties: { type: { value: "Change", required: true } } }));
failed += report("literal accepts its value", validate("draft", "draft"));
failed += reportReject("literal rejects another value", validate("draft", "published"));
failed += reportReject("literal rejects another kind", validate(1, "1"));
failed += report("null literal accepts null", validate(null, null));
failed += reportReject("null literal rejects a string", validate(null, "null"));
failed += report("an empty union is a schema", validate(meta, { anyOf: [] }));
const none = { type: U("none") };
for (const value of [null, false, true, 0, 1.5, "", "null", [], {}, bytes("QQ"), cid("bafy")]) {
  failed += reportReject(`none rejects ${JSON.stringify(value)}`, validate(none, value));
  failed += reportReject(`empty union rejects ${JSON.stringify(value)}`, validate({ anyOf: [] }, value));
  failed += report(`any accepts ${JSON.stringify(value)}`, validate({ type: U("any") }, value));
  for (const nullSchema of [null, { type: U("null") }]) {
    const check = value === null ? report : reportReject;
    failed += check(`null schema ${value === null ? "accepts" : "rejects"} ${JSON.stringify(value)}`, validate(nullSchema, value));
  }
}
failed += report("none does not prevent another union arm from matching", validate({ anyOf: [none, null] }, null));
failed += reportReject("none adds no values to a union", validate({ anyOf: [none, null] }, false));
for (const [schema, empty, nonempty] of [
  [{ type: U("list"), items: none }, [], [null]],
  [{ type: U("map"), values: none }, {}, { extra: null }],
]) {
  failed += report("a container of none accepts the empty container", validate(schema, empty));
  failed += reportReject("a container of none rejects an element", validate(schema, nonempty));
}
const noExtras = { type: U("struct"), properties: { name: { value: { type: U("string") }, required: true } }, values: none };
failed += report("none forbids extras without rejecting declared fields", validate(noExtras, { name: "Ada" }));
failed += reportReject("none rejects an additional null field", validate(noExtras, { name: "Ada", extra: null }));
const optionalNone = { type: U("struct"), properties: { forbidden: { value: none } } };
failed += report("an optional none field can be absent", validate(optionalNone, {}));
failed += reportReject("an optional none field cannot be null", validate(optionalNone, { forbidden: null }));
const requiredNone = { type: U("struct"), properties: { forbidden: { value: none, required: true } } };
failed += reportReject("a required none field cannot be absent", validate(requiredNone, {}));
failed += reportReject("a required none field cannot be null", validate(requiredNone, { forbidden: null }));
failed += report("described literal accepts its value", validate({ value: 3, description: "three" }, 3));
const status = { anyOf: ["draft", { value: "published", description: "Live" }, "archived"] };
failed += report("union of literals accepts a member", validate(status, "published"));
failed += reportReject("union of literals rejects a non-member", validate(status, "deleted"));
const tagged = { type: U("struct"), properties: { type: { value: "Change", required: true }, n: { value: 1 } } };
failed += report("a pinned tag field accepts the tag", validate(tagged, { type: "Change", n: 1 }));
failed += reportReject("a pinned tag field rejects another tag", validate(tagged, { type: "Comment", n: 1 }));
failed += reportReject("a pinned integer field rejects another integer", validate(tagged, { type: "Change", n: 2 }));
const pinned = { type: `hm://${LIBRARY_AUTHORITY}/block/base`, properties: { type: { value: "Poll", required: true } } };
failed += report("an extension can pin a field to a literal", validate(pinned, { id: "b1", type: "Poll" }));
failed += reportReject("…and then rejects the base's other tags", validate(pinned, { id: "b1", type: "Paragraph" }));

// =====================================================================
// 3b. Intersections — `allOf` merges its struct arms into one struct.
// =====================================================================
section("Intersections (allOf)");
const P = (n) => `hm://${LIBRARY_AUTHORITY}/example/${n}`;
const staff = load("example/staff-member.schema.json");
failed += report("an intersection of two named structs is a schema", validate(meta, staff));
failed += report("an intersection with an inline struct arm is a schema", validate(meta, { allOf: [{ type: P("person") }, { type: U("struct"), properties: { badge: { value: { type: U("string") } } } }] }));
failed += reportReject("an empty intersection is not a schema", validate(meta, { allOf: [] }));
failed += reportReject("an intersection cannot also name a type", validate(meta, { allOf: [{ type: P("person") }], type: P("contact") }));
failed += reportReject("an intersection cannot carry properties of its own (use an inline arm)", validate(meta, { allOf: [{ type: P("person") }], properties: {} }));
failed += reportReject("intersection with a non-schema arm", validate(meta, { allOf: [{ nope: 1 }] }));
const staffOk = { name: "Grace", employeeId: "E-1", email: "grace@example.org" };
failed += report("staff-member: fields of both arms", validate(staff, { ...staffOk, age: 36, department: "R&D", phone: "+1 555 0100", nicknames: ["G"] }));
failed += reportReject("staff-member: requires employee's employeeId", validate(staff, { name: "Grace", email: "g@example.org" }));
failed += reportReject("staff-member: requires contact's email", validate(staff, { name: "Grace", employeeId: "E-1" }));
failed += reportReject("staff-member: requires person's name (through the employee arm)", validate(staff, { employeeId: "E-1", email: "g@example.org" }));
failed += reportReject("staff-member: stays closed", validate(staff, { ...staffOk, badge: 7 }));
failed += assertPath("staff-member: a bad field is reported by name", validate(staff, { ...staffOk, age: "old" }), "$.age");
const resolvedStaff = resolveSchema(staff).schema;
failed += report("the merged struct is a struct", kindOf(resolvedStaff.type) === "struct" ? [] : ["expected struct"]);
failed += report("the merged struct has every field once", structFields(resolvedStaff).length === 9 ? [] : [`got ${structFields(resolvedStaff).length} fields`]);
const withBadge = { allOf: [{ type: P("employee") }, { type: U("struct"), properties: { badge: { value: { type: U("integer") }, required: true } } }] };
failed += report("an inline arm adds fields", validate(withBadge, { name: "A", employeeId: "E", badge: 1 }));
failed += reportReject("…and can require them", validate(withBadge, { name: "A", employeeId: "E" }));
const sameField = { allOf: [{ type: P("person") }, { type: U("struct"), properties: { name: { value: { type: U("string") }, required: true } } }] };
failed += report("arms may repeat a field when they agree on it", validate(sameField, { name: "A" }));
const conflict = { allOf: [{ type: P("person") }, { type: U("struct"), properties: { name: { value: { type: U("integer") } } } }] };
failed += reportReject("arms that define a field differently accept nothing", validate(conflict, { name: "A" }));
failed += assertPath("…and say which field", validate(conflict, { name: "A" }), 'field "name"');
failed += reportReject("a scalar arm accepts nothing", validate({ allOf: [{ type: P("person") }, { type: U("string") }] }, { name: "A" }));
failed += reportReject("a union arm accepts nothing", validate({ allOf: [{ type: P("person") }, { type: P("status") }] }, { name: "A" }));
failed += reportReject("a literal arm accepts nothing", validate({ allOf: [{ type: P("person") }, "x"] }, { name: "A" }));
const openBoth = { allOf: [{ type: U("map"), values: { type: U("integer") } }, { type: U("struct"), properties: { total: { value: { type: U("integer") } } }, values: { type: U("integer") } }] };
failed += report("open arms that agree on `values` stay open", validate(openBoth, { total: 3, extra: 4 }));
failed += reportReject("…and still type the extras", validate(openBoth, { total: 3, extra: "x" }));
failed += reportReject("open arms that disagree on `values` accept nothing", validate({ allOf: [{ type: U("map"), values: { type: U("integer") } }, { type: U("map"), values: { type: U("string") } }] }, {}));
failed += reportReject("one closed arm closes the merge", validate({ allOf: [{ type: P("person") }, { type: U("map"), values: { type: U("integer") } }] }, { name: "A", extra: 1 }));
failed += report("intersections nest", validate({ allOf: [staff, { type: U("struct"), properties: { badge: { value: { type: U("integer") } } } }] }, { ...staffOk, badge: 1 }));
const genericMix = (Extra) => ({ params: { Extra }, allOf: [{ type: P("contact") }, { var: "Extra" }] });
failed += report("a generic intersection merges its parameter's default", validate(genericMix({ type: P("geo") }), { email: "e", lat: 1, lng: 2 }));
failed += reportReject("…and the merged arm's fields are required too", validate(genericMix({ type: P("geo") }), { email: "e" }));
failed += reportReject("an unbound parameter arm accepts nothing", validate({ allOf: [{ type: P("contact") }, { var: "Extra" }] }, { email: "e" }));

// =====================================================================
// 4. Data validation: each example accepts valid data and rejects invalid.
// =====================================================================
section("Data validates against its schema");

const CASES = [
  {
    schema: "example/geo.schema.json",
    valid: [{ lat: 51.5, lng: -0.12, altitude: 35 }, { lat: 0, lng: 0 }],
    invalid: [
      ["missing lng", { lat: 51.5 }],
      ["lat not a number", { lat: "x", lng: 0 }],
      ["altitude must be integer", { lat: 1, lng: 2, altitude: 3.5 }],
      ["unknown key", { lat: 1, lng: 2, foo: 3 }],
    ],
  },
  {
    schema: "example/status.schema.json",
    valid: ["draft", "published", "archived"],
    invalid: [["not a member", "deleted"], ["wrong kind", 5], ["null", null]],
  },
  {
    schema: "example/tags.schema.json",
    valid: [[], ["a", "b", "c"]],
    invalid: [["element not string", ["a", 2]], ["not a list", "nope"]],
  },
  {
    schema: "example/matrix.schema.json",
    valid: [[], [[1, 2], [3]], [[]]],
    invalid: [["inner element not integer", [[1, "x"]]], ["element not a list", [1, 2]]],
  },
  {
    schema: "example/metadata.schema.json",
    valid: [{}, { lang: "en", tone: "formal" }],
    invalid: [["value not string", { lang: 1 }]],
  },
  {
    schema: "example/registry.schema.json",
    valid: [{}, { u1: cid("bafyu1"), u2: cid("bafyu2") }],
    invalid: [["value not a link", { u1: "bafyu1" }], ["value is a map not a link", { u1: { name: "x" } }]],
  },
  {
    schema: "example/blob.schema.json",
    valid: [{ mime: "image/png", data: bytes("aGVsbG8"), size: 5 }, { mime: "text/plain", data: bytes("QQ") }],
    invalid: [
      ["missing data", { mime: "x" }],
      ["data not bytes", { mime: "x", data: "notbytes" }],
      ["size not integer", { mime: "x", data: bytes("QQ"), size: 1.5 }],
      ["unknown key", { mime: "x", data: bytes("QQ"), extra: 1 }],
    ],
  },
  {
    schema: "example/value.schema.json",
    valid: ["hi", 42, true, null],
    invalid: [["float not in the union", 3.14], ["list", [1]], ["map", { a: 1 }]],
  },
  {
    schema: "example/json.schema.json",
    valid: [
      null, true, 42, 3.14, "hi",
      [1, "two", true, null],
      { a: [1, 2], b: { c: "d" } },
      {},
      { deep: [{ x: [true, [null, "y"]] }] },
    ],
    invalid: [
      ["a link is not JSON", cid("bafy")],
      ["link nested in a map", { a: cid("bafy") }],
      ["link nested in a list", [1, cid("bafy")]],
    ],
  },
  {
    schema: "example/comment.schema.json",
    valid: [{ text: "hi" }, { text: "hi", author: cid("bafyp"), replies: [cid("bafyc1"), cid("bafyc2")] }],
    invalid: [
      ["missing text", {}],
      ["text not string", { text: 1 }],
      ["reply not a link", { text: "hi", replies: ["notlink"] }],
    ],
  },
  {
    schema: "example/tree.schema.json",
    valid: [{ value: 1 }, { value: 1, children: [cid("t1"), cid("t2")] }],
    invalid: [
      ["missing value", {}],
      ["value not integer", { value: "x" }],
      ["child is inline, not a link", { value: 1, children: [{ value: 2 }] }],
    ],
  },
  {
    schema: "example/entry.schema.json",
    valid: [{ name: "docs" }, { name: "docs", files: [cid("f")] }, { name: "a.txt", parent: cid("fold") }],
    invalid: [["missing name (both arms require it)", {}], ["unknown key in both arms", { name: "x", bogus: 1 }]],
  },
  {
    schema: "example/admin.schema.json",
    valid: [
      { name: "Root", employeeId: "E-0", permissions: { all: true } },
      { name: "Root", employeeId: "E-0", permissions: {}, age: 40, department: "IT" },
    ],
    invalid: [
      ["missing permissions (own required)", { name: "Root", employeeId: "E-0" }],
      ["missing employeeId (from employee)", { name: "Root", permissions: {} }],
      ["missing name (from person)", { employeeId: "E", permissions: {} }],
      ["unknown key (closed through the chain)", { name: "R", employeeId: "E", permissions: {}, ghost: 1 }],
    ],
  },
  {
    schema: "example/article.schema.json",
    valid: [
      { title: "Hi", slug: "hi", status: "draft", author: cid("bafyA") },
      {
        title: "Hypermedia", slug: "hypermedia", status: "published", author: cid("bafyA"),
        tags: ["types", "ipld"], body: bytes("QQ"), wordCount: 1200, featured: true,
        cover: cid("bafyBlob"), comments: [cid("c1"), cid("c2")], meta: { lang: "en" },
      },
    ],
    invalid: [
      ["missing title", { slug: "hi", status: "draft", author: cid("A") }],
      ["status not in enum", { title: "T", slug: "t", status: "bogus", author: cid("A") }],
      ["author not a link", { title: "T", slug: "t", status: "draft", author: "A" }],
      ["tag not a string", { title: "T", slug: "t", status: "draft", author: cid("A"), tags: [1] }],
      ["wordCount not integer", { title: "T", slug: "t", status: "draft", author: cid("A"), wordCount: 1.5 }],
      ["unknown key", { title: "T", slug: "t", status: "draft", author: cid("A"), views: 9 }],
    ],
  },
  {
    schema: "example/employee.schema.json",
    valid: [{ name: "Grace", employeeId: "E-1", department: "Research", active: true }],
    invalid: [
      ["missing added required", { name: "Grace" }],
      ["missing inherited required", { employeeId: "E-2" }],
      ["unknown key stays closed", { name: "Grace", employeeId: "E-1", salary: 1 }],
    ],
  },
  {
    schema: "example/person.schema.json",
    valid: [{ name: "Ada" }, { name: "Ada", age: 36, active: true, home: { street: "1 Analytical Way", city: "London" }, nicknames: ["Countess"] }],
    invalid: [["age not integer", { name: "Ada", age: "old" }], ["home missing city", { name: "Ada", home: { street: "x" } }]],
  },
  {
    schema: "example/document.schema.json",
    valid: [{ title: "Genesis", author: cid("bafyP"), body: bytes("aGVsbG8"), previous: cid("bafyD") }, { title: "Genesis" }],
    invalid: [["body not bytes", { title: "T", body: "hello" }], ["author not a link", { title: "T", author: "P" }]],
  },
  {
    schema: "example/folder.schema.json",
    valid: [{ name: "photos", files: [cid("f1")], subfolders: [cid("s1")] }, { name: "empty" }],
    invalid: [["file not a link", { name: "x", files: ["nope"] }]],
  },
  {
    schema: "example/counts.schema.json",
    valid: [{ Apples: 5, Oranges: 3 }, {}],
    invalid: [["value not integer", { Apples: "five" }]],
  },

  // --- Hypermedia CBOR blobs (real production data shapes) -----------------
  {
    schema: "ref.schema.json",
    valid: [
      { type: "Ref", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1700000000000, path: "/", heads: [cid("bafyH1")], genesisBlob: cid("bafyG"), generation: 1, visibility: "" },
      { type: "Ref", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1700000000000, heads: [] },
    ],
    invalid: [
      ["wrong type tag", { type: "Change", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, heads: [] }],
      ["missing heads (required)", { type: "Ref", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1 }],
      ["signer not bytes", { type: "Ref", signer: "notbytes", sig: bytes("c2ln"), ts: 1, heads: [] }],
      ["unknown key (closed)", { type: "Ref", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, heads: [], bogus: 1 }],
    ],
  },
  {
    schema: "capability.schema.json",
    valid: [{ type: "Capability", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, delegate: bytes("ZGVs"), role: "WRITER", label: "editor" }],
    invalid: [
      ["missing delegate (required)", { type: "Capability", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1 }],
      ["role not in enum", { type: "Capability", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, delegate: bytes("ZGVs"), role: "SUPERUSER" }],
    ],
  },
  {
    schema: "change.schema.json",
    valid: [
      { type: "Change", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, genesis: cid("bafyG"), deps: [cid("bafyD")], depth: 1,
        body: { opCount: 2, ops: [{ type: "MoveBlocks", blocks: ["b1"] }, { type: "ReplaceBlock", block: { id: "b1", type: "paragraph", text: "Hello", bold: true } }] } },
      { type: "Change", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1 },
    ],
    invalid: [
      ["ts not integer", { type: "Change", signer: bytes("cGs"), sig: bytes("c2ln"), ts: "yesterday" }],
      ["unknown op type", { type: "Change", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, body: { ops: [{ type: "Frobnicate" }] } }],
    ],
  },
  {
    schema: "blob/any.schema.json",
    valid: [
      { type: "Profile", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, name: "Alice" },
      { type: "Contact", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, subject: bytes("ZGVs"), name: "Bob" },
    ],
    invalid: [
      ["not a known blob type", { type: "Frobnicate", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1 }],
      ["missing base fields", { type: "Profile", name: "Alice" }],
    ],
  },
  {
    schema: "metadata.schema.json",
    valid: [
      { name: "My Doc", summary: "A doc.", contentWidth: "M", showOutline: true, theme: { headerLayout: "Center" }, customKey: "extra" },
      {},
    ],
    invalid: [["contentWidth not in enum", { contentWidth: "XL" }]],
  },

  // --- Block types: strict concrete types vs the open forward-compatible type
  {
    schema: "block/paragraph.schema.json",
    valid: [
      { id: "b1", type: "Paragraph", text: "Hello", annotations: [], attributes: { childrenType: "Group" } },
      { id: "b2", type: "Paragraph" },
    ],
    invalid: [
      ["wrong type tag", { id: "b", type: "Image" }],
      ["missing id", { type: "Paragraph" }],
      ["unknown top-level key (closed)", { id: "b", type: "Paragraph", bogus: 1 }],
    ],
  },
  {
    schema: "block/image.schema.json",
    valid: [{ id: "i1", type: "Image", link: "ipfs://bafyimg", attributes: { width: 640, name: "pic.png" } }],
    invalid: [["missing link (required)", { id: "i1", type: "Image" }]],
  },
  {
    // The core union WE define — strict, rejects block types outside the eleven.
    schema: "block/core.schema.json",
    valid: [{ id: "b1", type: "Paragraph", text: "hi" }, { id: "i1", type: "Image", link: "ipfs://x" }],
    invalid: [["a block type outside the core", { id: "p1", type: "Poll", question: "?" }]],
  },
  {
    // The extensible wire block = core OR custom — accepts core strictly AND any custom/future block.
    schema: "block.schema.json",
    valid: [
      { id: "b1", type: "Paragraph", text: "hi" },
      { id: "p1", type: "Poll", question: "Fave?", options: ["a", "b"], meta: { nested: true } },
      { id: "b2", type: "Image", link: "ipfs://x", attributes: { width: 100, custom: { deep: [1, 2] } } },
    ],
    invalid: [["missing id", { type: "Paragraph" }]],
  },
  {
    // A third party's custom block, extending the shared base like a core block.
    schema: "example/poll-block.schema.json",
    valid: [{ id: "p1", type: "Poll", question: "Q?", options: ["a", "b"], attributes: { multiple: true } }],
    invalid: [["missing options (required)", { id: "p1", type: "Poll", question: "Q?" }], ["wrong type", { id: "p1", type: "Paragraph" }]],
  },
  {
    // The app's block type = core union EXTENDED with their Poll. Strict: core + Poll only.
    schema: "example/app-block.schema.json",
    valid: [
      { id: "b1", type: "Paragraph", text: "hi" },
      { id: "p1", type: "Poll", question: "Fave?", options: ["a", "b"] },
    ],
    invalid: [["a type outside core + their extensions", { id: "w1", type: "Widget", foo: 1 }]],
  },
  {
    schema: "example/constrained.schema.json",
    valid: [
      { username: "alice", score: 50 },
      { username: "bob_1", score: 0, tags: ["x"] },
      { username: "abc", score: 100, tags: ["a", "b", "c"] },
    ],
    invalid: [
      ["username too short", { username: "ab", score: 10 }],
      ["username too long", { username: "abcdefghijklm", score: 10 }],
      ["username fails pattern", { username: "Alice!", score: 10 }],
      ["score below minimum", { username: "alice", score: -1 }],
      ["score above maximum", { username: "alice", score: 101 }],
      ["too many tags", { username: "alice", score: 10, tags: ["a", "b", "c", "d"] }],
      ["empty tags violates minItems", { username: "alice", score: 10, tags: [] }],
      ["missing required score", { username: "alice" }],
    ],
  },
  {
    schema: "any.schema.json",
    valid: [null, true, 42, 3.14, "x", [1, "two", { a: [true] }], { k: { nested: [1, 2] } }, cid("bafy"), bytes("QQ")],
    invalid: [],
  },
];

for (const c of CASES) {
  const schema = load(c.schema);
  const name = c.schema.replace(/\.json$/, "");
  (c.valid || []).forEach((d, i) => (failed += report(`${name}: valid #${i + 1}`, validate(schema, d))));
  (c.invalid || []).forEach(([note, d]) => (failed += reportReject(`${name}: rejects ${note}`, validate(schema, d))));
}

// =====================================================================
// 4b. Value constraints — string length/pattern, numeric bounds, list size.
// =====================================================================
section("Value constraints");
const S = (k, extra) => ({ type: `hm://${LIBRARY_AUTHORITY}/${k}`, ...extra });

// string minLength / maxLength (counted in code points)
const strLen = S("string", { minLength: 3, maxLength: 5 });
failed += report("string within length bounds", validate(strLen, "abcd"));
failed += report("string at min length", validate(strLen, "abc"));
failed += report("astral char counts as one code point", validate(strLen, "a\u{1F600}b"));
failed += reportReject("string too short", validate(strLen, "ab"));
failed += reportReject("string too long", validate(strLen, "abcdef"));

// string pattern (unanchored ECMAScript); an uncompilable pattern is ignored
const strPat = S("string", { pattern: "^[a-z]+$" });
failed += report("string matches pattern", validate(strPat, "hello"));
failed += reportReject("string does not match pattern", validate(strPat, "Hello1"));
failed += report("invalid regex is ignored (no throw, no error)", validate(S("string", { pattern: "(" }), "anything"));

// `format: date` — the built-in Date type is a string refinement whose pattern
// checks the ISO 8601 calendar-date shape (YYYY-MM-DD) without parsing.
const dateT = load("date.schema.json");
failed += report("date: ISO calendar date", validate(dateT, "2026-08-26"));
failed += report("date: leap day shape", validate(dateT, "2024-02-29"));
failed += reportReject("date: month 13", validate(dateT, "2026-13-01"));
failed += reportReject("date: slashes", validate(dateT, "26/08/2026"));
failed += reportReject("date: date-time is not a date", validate(dateT, "2026-08-26T10:00:00Z"));
failed += reportReject("date: not a string", validate(dateT, 20260826));
const dateTimeT = load("date-time.schema.json");
failed += report("date-time: RFC 3339 zulu", validate(dateTimeT, "2026-08-26T14:30:00Z"));
failed += report("date-time: offset + fraction", validate(dateTimeT, "2026-08-26T14:30:00.250+02:00"));
failed += reportReject("date-time: bare date", validate(dateTimeT, "2026-08-26"));

// `target` — a reference-valued string may name the schema its target should
// conform to. Allowed on the scalar and include variants (advisory; never
// dereferenced), rejected elsewhere because the variants are closed maps.
failed += report("target on a scalar reference", validate(meta, { type: "hm://hyper.media/string", format: "ipfs", target: "hm://acme/stats" }));
failed += report("target on an include reference", validate(meta, { type: "hm://hyper.media/hm-url", target: "hm://acme/place" }));
failed += reportReject("target on a map schema", validate(meta, { type: K("map"), properties: {}, target: "hm://acme/x" }));
failed += reportReject("target on a list schema", validate(meta, { type: K("list"), target: "hm://acme/x" }));
failed += report("target does not affect the value", validate({ type: "hm://hyper.media/string", format: "ipfs", target: "hm://acme/stats" }, "ipfs://bafyfoo"));

// integer minimum / maximum
const intRange = S("integer", { minimum: 0, maximum: 100 });
failed += report("integer within bounds", validate(intRange, 50));
failed += report("integer at minimum", validate(intRange, 0));
failed += reportReject("integer below minimum", validate(intRange, -1));
failed += reportReject("integer above maximum", validate(intRange, 101));

// float minimum / maximum
const floatRange = S("float", { minimum: 0, maximum: 1 });
failed += report("float within bounds", validate(floatRange, 0.5));
failed += reportReject("float below minimum", validate(floatRange, -0.5));

// list minItems / maxItems
const listSize = S("list", { minItems: 1, maxItems: 3, items: { type: "hm://hyper.media/string" } });
failed += report("list within size bounds", validate(listSize, ["a", "b"]));
failed += reportReject("list too short", validate(listSize, []));
failed += reportReject("list too long", validate(listSize, ["a", "b", "c", "d"]));

// advisory mode: same violations, surfaced as warnings rather than blocking
failed += reportReject("advisory mode surfaces the same violations", validateAdvisory(intRange, 999));
failed += report("advisory mode passes clean data", validateAdvisory(intRange, 5));

// =====================================================================
// 5. Error paths are precise (regression guard on error reporting).
// =====================================================================
section("Error paths point at the offending value");
failed += assertPath("nested list index", validate(load("example/matrix.schema.json"), [[1, "x"]]), "$[0][1]");
failed += assertPath("nested map key", validate(load("example/person.schema.json"), { name: "Ada", home: { street: "x" } }), "home");
failed += assertPath("deep JSON path", validate(load("example/json.schema.json"), { a: [1, cid("bad")] }), "$.a[1]");
failed += assertPath("article field", validate(load("example/article.schema.json"), { title: "T", slug: "t", status: "draft", author: cid("A"), wordCount: 1.5 }), "$.wordCount");

// =====================================================================
// 5b. Generics: Change<Block>. The block type threads through
//     change -> body -> op -> replace-block, so binding Block makes the
//     WHOLE Change strict over that block set — deep inside the op stack.
// =====================================================================
section("Generics: Change<Block> instantiation");
const blockChange = (b) => ({ type: "Change", signer: bytes("cGs"), sig: bytes("c2ln"), ts: 1, body: { ops: [{ type: "ReplaceBlock", block: b }] } });
const widgetBlock = { id: "w1", type: "Widget", foo: 1 };
const pollBlock = { id: "p1", type: "Poll", question: "?", options: ["a", "b"] };
const paraBlock = { id: "b1", type: "Paragraph", text: "hi" };
failed += report("default Change accepts an unknown Widget block (open Block)", validate(load("change.schema.json"), blockChange(widgetBlock)));
failed += report("Change<app-block> accepts the app's Poll block", validate(load("example/myapp-change.schema.json"), blockChange(pollBlock)));
failed += report("Change<app-block> accepts a core Paragraph block", validate(load("example/myapp-change.schema.json"), blockChange(paraBlock)));
failed += reportReject("Change<app-block> REJECTS the Widget block (strict, deep in the op)", validate(load("example/myapp-change.schema.json"), blockChange(widgetBlock)));
failed += assertPath("the rejection points inside the op stack", validate(load("example/myapp-change.schema.json"), blockChange(widgetBlock)), "body.ops[0].block");

// (The example documents — bob : employee, alice : person, root : admin — are checked against
// their `attributesSchema` by check.mjs, which reads their frontmatter.)

process.exit(failed ? 1 : 0);
} // end if (RUN)

// --- reporting helpers -------------------------------------------------

function section(title) {
  console.log(`\n== ${title} ==`);
}

function report(label, errors) {
  if (errors.length === 0) {
    console.log(`  ok   ${label}`);
    return 0;
  }
  console.log(`  FAIL ${label}`);
  for (const e of errors) console.log(`         ${e}`);
  return 1;
}

// Inverted check: passes when validation correctly FAILS.
function reportReject(label, errors) {
  if (errors.length > 0) {
    console.log(`  ok   ${label} (rejected)`);
    return 0;
  }
  console.log(`  FAIL ${label} — was accepted but should be rejected`);
  return 1;
}

// Passes when some error message mentions the expected path fragment.
function assertPath(label, errors, expected) {
  if (errors.some((e) => e.includes(expected))) {
    console.log(`  ok   ${label} -> ${expected}`);
    return 0;
  }
  console.log(`  FAIL ${label} — expected an error at ${expected}, got: ${errors.join(" | ") || "(none)"}`);
  return 1;
}
