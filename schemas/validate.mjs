// Reference validator for Onyx schemas.
//
//   node validate.mjs                  -> self-description proof + example checks
//   node validate.mjs <schema> <data>  -> validate a JSON data file against a schema
//
// Onyx data model (9 kinds): null, boolean, integer, float, string, bytes,
// list, map, link. In human/dag-json form, a link is {"/":"<cid>"} and bytes
// is {"/":{"bytes":"<base64>"}} -- both are distinct kinds, NOT maps.
//
// Schema vocabulary: type, properties, required, items, values, enum, ref, anyOf.
//   - `anyOf`                   -> union: value must match one of the variants.
//   - `ref` with no `type`      -> include: defer entirely to that schema file.
//   - `type:"link"` with `ref`  -> typed link: target should match that schema
//                                  (checked lazily, not here).
//   - a `map` with `properties` and no `values` is CLOSED: unknown keys are
//     rejected. With `values`, extra keys must match the `values` schema.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

// References are hm:// URLs; local filenames are their dev alias. Each authority
// maps to a filename prefix. This is the ONLY place the mapping lives.
const AUTHORITY = [["onyx-", "hyper.media"], ["example-", "example.com"]];
const urlToFile = (ref) => {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref);
  if (!m) return ref.endsWith(".json") ? ref : `${ref}.json`;
  const [, auth, name] = m;
  const prefix = AUTHORITY.find(([, a]) => a === auth)?.[0];
  return prefix ? `${prefix}${name}.json` : `${name}.json`;
};

const cache = new Map();
export const load = (ref) => {
  const file = urlToFile(ref); // accepts an hm:// URL or a bare filename
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(resolve(DIR, file), "utf8")));
  return cache.get(file);
};

// An instance is data typed by a schema: { "$type": <schema-url>, "value": … }.
export const isInstance = (doc) => !!(doc && typeof doc === "object" && doc.$type && "value" in doc);

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

// A `type` value is a kind URL (hm://hyper.media/<kind>); read the kind locally
// off the URL — no fetch needed, so the discriminant stays local.
const KIND_URL = /^hm:\/\/hyper\.media\/([a-z]+)$/;
const kindOf = (t) => KIND_URL.exec(t)?.[1] ?? t;

function typeMatches(type, d) {
  switch (type) {
    case "null": return d === null;
    case "boolean": return typeof d === "boolean";
    case "integer": return typeof d === "number" && Number.isInteger(d);
    case "float": return typeof d === "number"; // JSON can't distinguish 3.0 from 3
    case "string": return typeof d === "string";
    case "bytes": return isBytes(d);
    case "list": return Array.isArray(d);
    case "map": return typeOf(d) === "map";
    case "link": return isLink(d);
    default: return false;
  }
}

// Resolve a reference node (`ref`, no `type`) to a concrete schema.
//   { ref: X }                       -> include: X exactly
//   { ref: X, properties|required|…} -> EXTEND X: merge parent + these refinements
// Extension is a subtype: parent's fields plus the new ones, required unioned.
export function concrete(schema, seen = new Set()) {
  if (!schema.ref || schema.type || schema.anyOf) return schema;
  if (seen.has(schema.ref)) return schema; // guard against ref cycles
  seen.add(schema.ref);
  const parent = concrete(load(schema.ref), seen);
  if (parent.anyOf) return parent;
  const extends_ = ["properties", "required", "values", "items", "enum"].some((k) => schema[k] !== undefined);
  if (!extends_) return parent; // pure include
  const merged = { type: parent.type };
  const props = { ...(parent.properties || {}), ...(schema.properties || {}) };
  if (Object.keys(props).length) merged.properties = props;
  const req = [...new Set([...(parent.required || []), ...(schema.required || [])])];
  if (req.length) merged.required = req;
  const values = schema.values ?? parent.values;
  if (values) merged.values = values;
  const items = schema.items ?? parent.items;
  if (items) merged.items = items;
  const en = schema.enum ?? parent.enum;
  if (en) merged.enum = en;
  return merged;
}

// Returns a list of error strings. Empty == valid.
export function validate(schema, data, path = "$") {
  schema = concrete(schema); // resolve includes / extensions

  // union: matches if it matches any variant.
  if (schema.anyOf) {
    const attempts = schema.anyOf.map((v) => validate(v, data, path));
    if (attempts.some((e) => e.length === 0)) return [];
    // None matched. Surface the *closest* arm: prefer one whose kind matched
    // (errors are nested, not a top-level "expected X"), then the fewest errors.
    const topLevel = (errs) => errs.some((e) => e.startsWith(`${path}: expected`));
    const best = attempts.slice().sort((a, b) => topLevel(a) - topLevel(b) || a.length - b.length)[0];
    return [`${path}: matches none of the ${schema.anyOf.length} variants`, ...best];
  }

  const errors = [];

  if (schema.enum && !schema.enum.some((v) => deepEqual(v, data))) {
    errors.push(`${path}: ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  const kind = schema.type ? kindOf(schema.type) : null;

  if (kind && !typeMatches(kind, data)) {
    errors.push(`${path}: expected ${kind}, got ${typeOf(data)}`);
    return errors; // wrong kind -> deeper checks would be noise
  }

  if (kind === "map") {
    for (const key of schema.required ?? []) {
      if (!(key in data)) errors.push(`${path}: missing required "${key}"`);
    }
    const closed = schema.properties && !schema.values;
    for (const [key, value] of Object.entries(data)) {
      const child = schema.properties?.[key] ?? schema.values;
      if (child) errors.push(...validate(child, value, `${path}.${key}`));
      else if (closed) errors.push(`${path}: unexpected key "${key}"`);
    }
  }

  if (kind === "list" && schema.items) {
    data.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }

  // `type:"link"` + `ref` is a typed link; the target lives in another block,
  // so we confirm the envelope is well-formed and defer target checking.

  return errors;
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
const meta = load("onyx-schema.json");

// dag-json constructors for test data
const cid = (s) => ({ "/": s });
const bytes = (b) => ({ "/": { bytes: b } });

// =====================================================================
// 1. Self-description — the meta-schema is a valid instance of itself.
// =====================================================================
section("Self-description");
failed += report("onyx-schema.json describes itself", validate(meta, meta));

// =====================================================================
// 2. Every schema block in the directory is a valid Onyx schema.
//    Auto-discovered, so new examples are covered without editing tests.
// =====================================================================
section("Every schema block is a valid Onyx schema");
const jsonFiles = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
for (const f of jsonFiles) {
  if (isInstance(load(f))) continue; // instances are data, not schemas
  failed += report(`${f}`, validate(meta, load(f)));
}

// =====================================================================
// 3. The discriminated union REJECTS malformed schemas.
// =====================================================================
section("The meta-schema rejects malformed schemas");
const K = (k) => `hm://hyper.media/${k}`;
failed += reportReject("scalar carrying `items`", validate(meta, { type: K("string"), items: { type: K("integer") } }));
failed += reportReject("scalar carrying `properties`", validate(meta, { type: K("string"), properties: {} }));
failed += reportReject("map schema with an unknown keyword", validate(meta, { type: K("map"), bogus: 1 }));
failed += reportReject("node with neither type nor ref nor anyOf", validate(meta, { properties: {} }));
failed += reportReject("union with a non-schema arm", validate(meta, { anyOf: [{ nope: 1 }] }));
failed += reportReject("bare kind name instead of a URL", validate(meta, { type: "string" }));

// =====================================================================
// 4. Data validation: each example accepts valid data and rejects invalid.
// =====================================================================
section("Data validates against its schema");

const CASES = [
  {
    schema: "example-geo.json",
    valid: [{ lat: 51.5, lng: -0.12, altitude: 35 }, { lat: 0, lng: 0 }],
    invalid: [
      ["missing lng", { lat: 51.5 }],
      ["lat not a number", { lat: "x", lng: 0 }],
      ["altitude must be integer", { lat: 1, lng: 2, altitude: 3.5 }],
      ["unknown key", { lat: 1, lng: 2, foo: 3 }],
    ],
  },
  {
    schema: "example-status.json",
    valid: ["draft", "published", "archived"],
    invalid: [["not in enum", "deleted"], ["wrong kind", 5], ["null", null]],
  },
  {
    schema: "example-tags.json",
    valid: [[], ["a", "b", "c"]],
    invalid: [["element not string", ["a", 2]], ["not a list", "nope"]],
  },
  {
    schema: "example-matrix.json",
    valid: [[], [[1, 2], [3]], [[]]],
    invalid: [["inner element not integer", [[1, "x"]]], ["element not a list", [1, 2]]],
  },
  {
    schema: "example-metadata.json",
    valid: [{}, { lang: "en", tone: "formal" }],
    invalid: [["value not string", { lang: 1 }]],
  },
  {
    schema: "example-registry.json",
    valid: [{}, { u1: cid("bafyu1"), u2: cid("bafyu2") }],
    invalid: [["value not a link", { u1: "bafyu1" }], ["value is a map not a link", { u1: { name: "x" } }]],
  },
  {
    schema: "example-blob.json",
    valid: [{ mime: "image/png", data: bytes("aGVsbG8"), size: 5 }, { mime: "text/plain", data: bytes("QQ") }],
    invalid: [
      ["missing data", { mime: "x" }],
      ["data not bytes", { mime: "x", data: "notbytes" }],
      ["size not integer", { mime: "x", data: bytes("QQ"), size: 1.5 }],
      ["unknown key", { mime: "x", data: bytes("QQ"), extra: 1 }],
    ],
  },
  {
    schema: "example-value.json",
    valid: ["hi", 42, true, null],
    invalid: [["float not in the union", 3.14], ["list", [1]], ["map", { a: 1 }]],
  },
  {
    schema: "example-json.json",
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
    schema: "example-comment.json",
    valid: [{ text: "hi" }, { text: "hi", author: cid("bafyp"), replies: [cid("bafyc1"), cid("bafyc2")] }],
    invalid: [
      ["missing text", {}],
      ["text not string", { text: 1 }],
      ["reply not a link", { text: "hi", replies: ["notlink"] }],
    ],
  },
  {
    schema: "example-tree.json",
    valid: [{ value: 1 }, { value: 1, children: [cid("t1"), cid("t2")] }],
    invalid: [
      ["missing value", {}],
      ["value not integer", { value: "x" }],
      ["child is inline, not a link", { value: 1, children: [{ value: 2 }] }],
    ],
  },
  {
    schema: "example-entry.json",
    valid: [{ name: "docs" }, { name: "docs", files: [cid("f")] }, { name: "a.txt", parent: cid("fold") }],
    invalid: [["missing name (both arms require it)", {}], ["unknown key in both arms", { name: "x", bogus: 1 }]],
  },
  {
    schema: "example-admin.json",
    valid: [
      { name: "Root", employeeId: "E-0", permissions: ["all"] },
      { name: "Root", employeeId: "E-0", permissions: [], age: 40, department: "IT" },
    ],
    invalid: [
      ["missing permissions (own required)", { name: "Root", employeeId: "E-0" }],
      ["missing employeeId (from employee)", { name: "Root", permissions: [] }],
      ["missing name (from person)", { employeeId: "E", permissions: [] }],
      ["unknown key (closed through the chain)", { name: "R", employeeId: "E", permissions: [], ghost: 1 }],
    ],
  },
  {
    schema: "example-article.json",
    valid: [
      { title: "Hi", slug: "hi", status: "draft", author: cid("bafyA") },
      {
        title: "Onyx", slug: "onyx", status: "published", author: cid("bafyA"),
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
    schema: "example-employee.json",
    valid: [{ name: "Grace", employeeId: "E-1", department: "Research", active: true }],
    invalid: [
      ["missing added required", { name: "Grace" }],
      ["missing inherited required", { employeeId: "E-2" }],
      ["unknown key stays closed", { name: "Grace", employeeId: "E-1", salary: 1 }],
    ],
  },
  {
    schema: "example-person.json",
    valid: [{ name: "Ada" }, { name: "Ada", age: 36, active: true, home: { street: "1 Analytical Way", city: "London" }, nicknames: ["Countess"] }],
    invalid: [["age not integer", { name: "Ada", age: "old" }], ["home missing city", { name: "Ada", home: { street: "x" } }]],
  },
  {
    schema: "example-document.json",
    valid: [{ title: "Genesis", author: cid("bafyP"), body: bytes("aGVsbG8"), previous: cid("bafyD") }, { title: "Genesis" }],
    invalid: [["body not bytes", { title: "T", body: "hello" }], ["author not a link", { title: "T", author: "P" }]],
  },
  {
    schema: "example-folder.json",
    valid: [{ name: "photos", files: [cid("f1")], subfolders: [cid("s1")] }, { name: "empty" }],
    invalid: [["file not a link", { name: "x", files: ["nope"] }]],
  },
  {
    schema: "example-counts.json",
    valid: [{ Apples: 5, Oranges: 3 }, {}],
    invalid: [["value not integer", { Apples: "five" }]],
  },
];

for (const c of CASES) {
  const schema = load(c.schema);
  const name = c.schema.replace(/\.json$/, "");
  (c.valid || []).forEach((d, i) => (failed += report(`${name}: valid #${i + 1}`, validate(schema, d))));
  (c.invalid || []).forEach(([note, d]) => (failed += reportReject(`${name}: rejects ${note}`, validate(schema, d))));
}

// =====================================================================
// 5. Error paths are precise (regression guard on error reporting).
// =====================================================================
section("Error paths point at the offending value");
failed += assertPath("nested list index", validate(load("example-matrix.json"), [[1, "x"]]), "$[0][1]");
failed += assertPath("nested map key", validate(load("example-person.json"), { name: "Ada", home: { street: "x" } }), "home");
failed += assertPath("deep JSON path", validate(load("example-json.json"), { a: [1, cid("bad")] }), "$.a[1]");
failed += assertPath("article field", validate(load("example-article.json"), { title: "T", slug: "t", status: "draft", author: cid("A"), wordCount: 1.5 }), "$.wordCount");

// =====================================================================
// 6. Example instances are valid data for their declared type.
//    (bob : employee, alice : person, root : admin, …)
// =====================================================================
section("Example instances validate against their type");
for (const f of jsonFiles) {
  const doc = load(f);
  if (!isInstance(doc)) continue;
  failed += report(`${f} is a valid ${doc.$type.split("/").pop()}`, validate(load(doc.$type), doc.value));
}

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
