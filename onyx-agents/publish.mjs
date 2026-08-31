// Publish step for the AGENTS schema library: hash every schema to its IPFS
// CID and write a manifest. A parameterized sibling of onyx/publish.mjs.
//
//   node publish.mjs            -> regenerate schemas.lock.json (hm:// URL -> CID)
//   node publish.mjs --check    -> fail if the lockfile is out of date (for CI)
//
// Refs inside a schema stay hm:// URLs (names), NOT CIDs — see onyx/publish.mjs
// for why (cycles, per-schema CID stability). This manifest is the separate
// name -> CID index a resolver uses.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";

const DIR = dirname(fileURLToPath(import.meta.url));
const LOCK = resolve(DIR, "schemas.lock.json");

// The agents schema account. Names are published verbatim (no prefix stripping).
const ACCOUNT = "z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ";
const fileToUrl = (file) => `hm://${ACCOUNT}/${file.replace(/\.json$/, "")}`;

async function cidOf(obj) {
  const bytes = dagCbor.encode(obj); // canonical DAG-CBOR
  const hash = await sha256.digest(bytes);
  return { cid: CID.create(1, dagCbor.code, hash).toString(), size: bytes.length };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "schemas.lock.json").sort();
const schemas = {};
let totalBytes = 0;
for (const f of files) {
  const obj = JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
  const { cid, size } = await cidOf(obj);
  // determinism self-check: a key-shuffled copy must hash to the same CID.
  const { cid: cid2 } = await cidOf(Object.fromEntries(Object.entries(obj).reverse()));
  if (cid !== cid2) {
    console.error(`NON-DETERMINISTIC encoding for ${f}`);
    process.exit(1);
  }
  schemas[fileToUrl(f)] = cid;
  totalBytes += size;
}

const sorted = Object.fromEntries(Object.keys(schemas).sort().map((k) => [k, schemas[k]]));
const manifest = {
  "//": "Agents schema manifest — hm:// URL -> DAG-CBOR CID (CIDv1, sha2-256). Deterministic; regenerate with `node publish.mjs`.",
  codec: "dag-cbor",
  hash: "sha2-256",
  count: files.length,
  schemas: sorted,
};
const rendered = JSON.stringify(manifest, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = readFileSync(LOCK, "utf8");
  if (current !== rendered) {
    console.error("schemas.lock.json is out of date — run `node publish.mjs` and commit.");
    process.exit(1);
  }
  console.log(`schemas.lock.json is up to date (${files.length} schemas).`);
} else {
  writeFileSync(LOCK, rendered);
  console.log(`published ${files.length} schemas (${totalBytes} bytes of DAG-CBOR) -> schemas.lock.json`);
}
