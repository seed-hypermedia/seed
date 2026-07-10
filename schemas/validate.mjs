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

import { readFileSync } from "node:fs";
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
const load = (ref) => {
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

// Returns a list of error strings. Empty == valid.
function validate(schema, data, path = "$") {
  // union: matches if it matches any variant.
  if (schema.anyOf) {
    if (schema.anyOf.some((v) => validate(v, data, path).length === 0)) return [];
    return [`${path}: matches none of the ${schema.anyOf.length} schema variants`];
  }

  // include: a node with `ref` and no `type` defers to the referenced schema.
  if (schema.ref && !schema.type) return validate(load(schema.ref), data, path);

  const errors = [];

  if (schema.enum && !schema.enum.some((v) => deepEqual(v, data))) {
    errors.push(`${path}: ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type && !typeMatches(schema.type, data)) {
    errors.push(`${path}: expected ${schema.type}, got ${typeOf(data)}`);
    return errors; // wrong kind -> deeper checks would be noise
  }

  if (schema.type === "map") {
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

  if (schema.type === "list" && schema.items) {
    data.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }

  // `type:"link"` + `ref` is a typed link; the target lives in another block,
  // so we confirm the envelope is well-formed and defer target checking.

  return errors;
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- CLI ---------------------------------------------------------------

const [, , schemaArg, dataArg] = process.argv;

if (schemaArg && dataArg) {
  const errors = validate(load(schemaArg), JSON.parse(readFileSync(dataArg, "utf8")));
  report(`${dataArg} against ${schemaArg}`, errors);
  process.exit(errors.length ? 1 : 0);
}

let failed = 0;
const meta = load("onyx-schema.json");

// The proof: the meta-schema (a discriminated union) is a valid instance of itself,
// and so is every one of its variants.
failed += report("onyx-schema.json describes itself", validate(meta, meta));
for (const v of ["map", "list", "scalar", "link", "include", "union"])
  failed += report(`onyx-${v}-schema.json is a valid schema`, validate(meta, load(`onyx-${v}-schema.json`)));
// The primitive standard library — each onyx-<kind> is an instance of the meta-schema.
const KINDS = ["null", "boolean", "integer", "float", "string", "bytes", "link", "map", "list"];
for (const k of KINDS)
  failed += report(`onyx-${k}.json is a valid schema`, validate(meta, load(`onyx-${k}.json`)));
for (const s of ["example-person", "example-address", "example-document", "example-folder", "example-file"])
  failed += report(`${s}.json is a valid schema`, validate(meta, load(`${s}.json`)));

// The discriminated union now REJECTS structurally invalid schemas.
failed += reportReject(
  "rejects a string-that-is-also-a-list-and-struct",
  validate(meta, { type: "string", items: { type: "integer" }, properties: {} })
);

// Data documents (dag-json human form).
const person = {
  name: "Ada",
  age: 36,
  active: true,
  home: { street: "1 Analytical Way", city: "London" },
  nicknames: ["Countess"],
};
failed += report("person data is valid", validate(load("example-person.json"), person));
failed += reportReject("closed map rejects unknown key", validate(load("example-person.json"), { ...person, mystery: 1 }));

const document = {
  title: "Genesis",
  author: { "/": "bafyreiapersoncidgoeshere0000000000000000000000000000" },
  body: { "/": { bytes: "aGVsbG8" } }, // base64("hello")
  previous: { "/": "bafyreiapreviousdoccid00000000000000000000000000000" },
};
failed += report("document data is valid (link + bytes)", validate(load("example-document.json"), document));

// Mutual recursion by NAME (folder <-> file): links hold CIDs, so validation
// never loops. This cycle is exactly what content-addressing alone cannot name.
const folder = {
  name: "photos",
  files: [{ "/": "bafyfile000000000000000000000000000000000000000000" }],
  subfolders: [{ "/": "bafyfolder00000000000000000000000000000000000000000" }],
};
failed += report("folder data is valid (mutual-recursion schema)", validate(load("example-folder.json"), folder));

process.exit(failed ? 1 : 0);

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
