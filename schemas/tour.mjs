// Onyx tour server — a self-generating guided browse of the type system.
//
//   node tour.mjs            (serves on http://localhost:4747)
//   PORT=8080 node tour.mjs
//
// Renders the markdown docs, auto-builds a schema explorer from the .json
// files (fields, kinds, a dependency DAG, clickable refs), and runs the real
// validator once at startup for a live "self-validates" badge. No dependencies.

import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4747;

const base = (n) => n.replace(/\.(json|md)$/, "");
const files = readdirSync(DIR);
const SCHEMA_FILES = files.filter((f) => f.endsWith(".json")).sort();
const isSchema = (v) => SCHEMA_FILES.includes(v);
const loadJson = (name) => JSON.parse(readFileSync(resolve(DIR, name), "utf8"));
const loadText = (name) => readFileSync(resolve(DIR, name), "utf8");

// References are hm:// URLs; local filenames are their dev alias. Each authority
// maps to a filename prefix (the ONE place the mapping lives).
const AUTHORITY = [["onyx-", "hyper.media"], ["example-", "example.com"]];
const fileToUrl = (file) => {
  const b = base(file);
  for (const [p, a] of AUTHORITY) if (b.startsWith(p)) return `hm://${a}/${b.slice(p.length)}`;
  return b;
};
const urlToFile = (ref) => {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref);
  if (!m) return ref.endsWith(".json") ? ref : `${ref}.json`;
  const prefix = AUTHORITY.find(([, a]) => a === m[1])?.[0];
  return prefix ? `${prefix}${m[2]}.json` : `${m[2]}.json`;
};
const refToSlug = (ref) => base(urlToFile(ref)); // hm:// URL -> local route slug
const refIsSchema = (ref) => SCHEMA_FILES.includes(urlToFile(ref));

const KINDS = ["null", "boolean", "integer", "float", "string", "bytes", "list", "map", "link"];

// The meta-schema is a discriminated union; its variants are the anyOf refs.
const META_ROOT = loadJson("onyx-schema.json");
const VARIANT_FILES = (META_ROOT.anyOf || []).map((r) => urlToFile(r.ref)).filter(Boolean);
const META_FILES = ["onyx-schema.json", ...VARIANT_FILES];
const isVariant = (f) => VARIANT_FILES.includes(f);

// The primitive standard library: onyx-<kind>.json, each just { "type": <kind> }.
const PRIMITIVE_FILES = KINDS.map((k) => `onyx-${k}.json`).filter((f) => SCHEMA_FILES.includes(f));
const isPrimitive = (f) => PRIMITIVE_FILES.includes(f);
const primitiveKind = (f) => {
  const s = loadJson(f);
  return Object.keys(s).length === 1 && typeof s.type === "string" ? s.type : null;
};

// Wire each kind to its canonical primitive schema (onyx-<kind>), so a kind
// badge like `string` links to onyx-string. This is what the user browses to.
const KIND_SCHEMA = {};
for (const k of KINDS) if (SCHEMA_FILES.includes(`onyx-${k}.json`)) KIND_SCHEMA[k] = `onyx-${k}`;

// And each kind to the meta variant that *types* it (scalar/map/list/link-schema).
const KIND_VARIANT = {};
for (const f of VARIANT_FILES) {
  const e = loadJson(f)?.properties?.type?.enum;
  if (Array.isArray(e)) for (const k of e) KIND_VARIANT[k] ??= base(f);
}

// The guided reading order (docs). Titles are read from each file's first heading.
const TOUR = [
  "data-model.md",
  "schema-language.md",
  "references.md",
  "encoding.md",
  "design-rationale.md",
  "glossary.md",
].filter((f) => files.includes(f)).map((f) => ({
  slug: base(f),
  file: f,
  title: (loadText(f).match(/^#\s+(.+)$/m)?.[1] ?? base(f)).trim(),
}));

// ---------------------------------------------------------------------------
// Markdown -> HTML (a compact renderer for the subset the docs use)
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function rewriteHref(url) {
  let u = url.trim();
  if (/^hm:\/\//.test(u)) return { href: "/schema/" + refToSlug(u), external: false };
  if (/^https?:\/\//.test(u)) return { href: u, external: true };
  u = u.replace(/^\.\//, "");
  const [path] = u.split("#");
  if (path.endsWith(".md")) return { href: "/doc/" + base(path), external: false };
  if (path.endsWith(".json")) return { href: "/schema/" + base(path), external: false };
  return { href: url, external: false };
}

function inline(str) {
  const codes = [];
  let s = esc(str).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `${codes.length - 1}`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const { href, external } = rewriteHref(url);
    const attr = external ? ' target="_blank" rel="noreferrer"' : "";
    return `<a href="${esc(href)}"${attr}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(\d+)/g, (_, i) => `<code>${codes[+i]}</code>`);
  return s;
}

const isTableSep = (l) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(l);
const cells = (l) =>
  l.trim().replace(/^\|/, "").replace(/\|$/, "")
    .split(/(?<!\\)\|/) // split on unescaped pipes only
    .map((c) => c.trim().replace(/\\\|/g, "|"));

function mdToHtml(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="code${lang ? " lang-" + lang : ""}"><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim().startsWith("|") && lines[i + 1] && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const trs = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]))
        items.push(inline(lines[i++].replace(/^\s*[-*]\s+/, "")));
      out.push(`<ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]))
        items.push(inline(lines[i++].replace(/^\s*\d+\.\s+/, "")));
      out.push(`<ol>${items.map((t) => `<li>${t}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s|---+\s*$)/.test(lines[i]) &&
      !(lines[i].trim().startsWith("|") && lines[i + 1] && isTableSep(lines[i + 1]))
    )
      buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Schema rendering (auto-generated from the JSON)
// ---------------------------------------------------------------------------

const kindTag = (k) => `<span class="kind kind-${k}">${k}</span>`; // plain, safe inside <a>
const kindBadge = (k) =>
  KIND_SCHEMA[k]
    ? `<a class="kind-link" href="/schema/${KIND_SCHEMA[k]}" title="defined by ${KIND_SCHEMA[k]}.json">${kindTag(k)}</a>`
    : kindTag(k);

function summarize(node) {
  if (!node) return `<span class="muted">any</span>`;
  if (node.anyOf)
    return `<span class="muted">one of</span> ${node.anyOf.map(summarize).join(` <span class="muted">|</span> `)}`;
  if (node.ref && !node.type) {
    const b = refToSlug(node.ref);
    const file = urlToFile(node.ref);
    // A reference to a primitive renders as its kind badge (which links to it).
    if (isPrimitive(file)) {
      const k = primitiveKind(file);
      if (k) return kindBadge(k);
    }
    return `<a class="chip include" href="/schema/${b}">↳ include ${b}</a>`;
  }
  if (node.type === "link") {
    const t = node.ref ? ` <a class="chip link-chip" href="/schema/${refToSlug(node.ref)}">→ ${refToSlug(node.ref)}</a>` : "";
    return kindBadge("link") + t;
  }
  if (node.type === "list")
    return `${kindBadge("list")} <span class="muted">of</span> ${summarize(node.items)}`;
  if (node.type === "map") {
    if (node.properties)
      return `${kindBadge("map")} <span class="muted">{ ${Object.keys(node.properties).length} fields }</span>`;
    if (node.values)
      return `${kindBadge("map")} <span class="muted">⟨ * :</span> ${summarize(node.values)} <span class="muted">⟩</span>`;
    return kindBadge("map");
  }
  if (node.enum) {
    const vals = node.enum.map((v) => `<code>${esc(JSON.stringify(v))}</code>`).join(" ");
    return `${node.type ? kindBadge(node.type) + " " : ""}<span class="muted">enum:</span> ${vals}`;
  }
  if (node.type) return kindBadge(node.type);
  return `<span class="muted">any</span>`;
}

// Recursively collect referenced schema basenames from a node.
function collectRefs(node, acc) {
  if (Array.isArray(node)) return node.forEach((n) => collectRefs(n, acc));
  if (node && typeof node === "object") {
    if (typeof node.ref === "string") acc.add(refToSlug(node.ref));
    for (const v of Object.values(node)) collectRefs(v, acc);
  }
}

function buildGraph() {
  const nodes = SCHEMA_FILES.map(base);
  const edges = [];
  const selfLoops = new Set();
  for (const f of SCHEMA_FILES) {
    const self = base(f);
    const acc = new Set();
    collectRefs(loadJson(f), acc);
    for (const t of acc) {
      if (t === self) selfLoops.add(self);
      else if (nodes.includes(t) && !edges.some((e) => e.from === self && e.to === t))
        edges.push({ from: self, to: t });
    }
  }
  return { nodes, edges, selfLoops };
}
const GRAPH = buildGraph();

function graphSvg() {
  // The primitive library is excluded from the DAG — every schema references
  // onyx-string, so it would swamp the diagram. It gets its own grid instead.
  const nodes = GRAPH.nodes.filter((n) => !isPrimitive(n + ".json"));
  const edges = GRAPH.edges.filter((e) => nodes.includes(e.from) && nodes.includes(e.to));
  const selfLoops = GRAPH.selfLoops;
  // layer(n) = 1 + max(layer of things n depends on); leaves = 0
  const layer = {};
  const out = (n) => edges.filter((e) => e.from === n).map((e) => e.to);
  const compute = (n, seen = new Set()) => {
    if (layer[n] != null) return layer[n];
    if (seen.has(n)) return 0;
    seen.add(n);
    const deps = out(n);
    layer[n] = deps.length ? 1 + Math.max(...deps.map((d) => compute(d, seen))) : 0;
    return layer[n];
  };
  nodes.forEach((n) => compute(n));
  const maxLayer = Math.max(0, ...nodes.map((n) => layer[n]));

  const colW = 190, rowH = 82, mx = 46, my = 44, nW = 132, nH = 38;
  const byLayer = {};
  nodes.forEach((n) => ((byLayer[layer[n]] ||= []).push(n)));
  const pos = {};
  for (let L = 0; L <= maxLayer; L++) {
    (byLayer[L] || []).forEach((n, r) => {
      pos[n] = { cx: mx + (maxLayer - L) * colW + nW / 2, cy: my + r * rowH + nH / 2 };
    });
  }
  const rows = Math.max(...Object.values(byLayer).map((a) => a.length), 1);
  const W = mx * 2 + (maxLayer + 1) * colW;
  const H = my * 2 + (rows - 1) * rowH + nH;

  const edgeSvg = edges
    .map(({ from, to }) => {
      const a = pos[from], b = pos[to];
      const x1 = a.cx + nW / 2, x2 = b.cx - nW / 2;
      return `<path class="edge" d="M ${x1} ${a.cy} C ${x1 + 40} ${a.cy}, ${x2 - 40} ${b.cy}, ${x2} ${b.cy}" marker-end="url(#arrow)"/>`;
    })
    .join("");
  const loopSvg = [...selfLoops]
    .map((n) => {
      const p = pos[n];
      const x = p.cx, y = p.cy - nH / 2;
      return `<path class="edge loop" d="M ${x - 16} ${y} C ${x - 30} ${y - 40}, ${x + 30} ${y - 40}, ${x + 16} ${y}" marker-end="url(#arrow)"/><text class="loop-label" x="${x}" y="${y - 34}">self</text>`;
    })
    .join("");
  const nodeSvg = nodes
    .map((n) => {
      const p = pos[n];
      const meta = n === "onyx-schema" ? " meta" : "";
      return `<a href="/schema/${n}"><rect class="node${meta}" x="${p.cx - nW / 2}" y="${p.cy - nH / 2}" width="${nW}" height="${nH}" rx="9"/><text class="node-label" x="${p.cx}" y="${p.cy}">${n}</text></a>`;
    })
    .join("");

  return `<svg class="graph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="schema dependency graph">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="arrowhead"/></marker></defs>
  ${edgeSvg}${loopSvg}${nodeSvg}
</svg>`;
}

// Pretty-print JSON with syntax colors and clickable refs.
function highlightJson(value, indent = 0, key = null) {
  const pad = "  ".repeat(indent), pad2 = "  ".repeat(indent + 1);
  if (value === null) return `<span class="j-null">null</span>`;
  if (Array.isArray(value)) {
    if (!value.length) return `<span class="j-punct">[]</span>`;
    const items = value.map((v) => pad2 + highlightJson(v, indent + 1)).join(`<span class="j-punct">,</span>\n`);
    return `<span class="j-punct">[</span>\n${items}\n${pad}<span class="j-punct">]</span>`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => `${pad2}<span class="j-key">"${esc(k)}"</span><span class="j-punct">:</span> ${highlightJson(v, indent + 1, k)}`)
      .join(`<span class="j-punct">,</span>\n`);
    return `<span class="j-punct">{</span>\n${entries}\n${pad}<span class="j-punct">}</span>`;
  }
  if (typeof value === "string") {
    if (key === "ref" && refIsSchema(value))
      return `<span class="j-str">"<a class="j-ref" href="/schema/${refToSlug(value)}">${esc(value)}</a>"</span>`;
    return `<span class="j-str">"${esc(value)}"</span>`;
  }
  if (typeof value === "boolean") return `<span class="j-bool">${value}</span>`;
  return `<span class="j-num">${esc(String(value))}</span>`;
}

function schemaPage(name) {
  const file = name + ".json";
  if (!SCHEMA_FILES.includes(file)) return null;
  const schema = loadJson(file);
  const isMeta = name === "onyx-schema";

  const outRefs = GRAPH.edges.filter((e) => e.from === name).map((e) => e.to);
  const inRefs = GRAPH.edges.filter((e) => e.to === name).map((e) => e.from);
  const selfRef = GRAPH.selfLoops.has(name);

  const isUnion = Array.isArray(schema.anyOf);
  const govKinds = schema.properties?.type?.enum || null; // kinds this variant governs
  const isPrim = isPrimitive(file);
  const primKind = isPrim ? primitiveKind(file) : null;

  // Body varies: a union shows its variants as cards; a map/variant shows fields.
  let lead, main;
  if (isPrim && primKind) {
    const variant = KIND_VARIANT[primKind];
    lead = `<p class="lead">${kindTag(primKind)} <span class="muted">· a primitive type — the standard-library schema for the <code>${primKind}</code> kind</span></p>`;
    main = `<div class="prim-body">
      <p>The entire schema is <code>{ "type": "${primKind}" }</code>. Reference it as <code>{ "ref": "${name}.json" }</code> to type any value as ${primKind} — on IPFS that <code>ref</code> becomes the CID of this block, so <strong>${primKind}</strong> is a content-addressed, reusable type.</p>
      ${variant ? `<p class="muted">Typed by <a href="/schema/${variant}">${variant}.json</a> — the meta-schema variant whose shape it fits.</p>` : ""}
    </div>`;
  } else if (isUnion) {
    lead = `<p class="lead"><span class="kind kind-union">discriminated union</span> <span class="muted">· ${schema.anyOf.length} variants, tagged on <code>type</code></span></p>`;
    const cards = schema.anyOf
      .map((v) => {
        const b = refToSlug(v.ref);
        const vs = loadJson(urlToFile(v.ref));
        const kinds = vs.properties?.type?.enum;
        const tag = kinds
          ? kinds.map(kindTag).join(" ")
          : b === "onyx-include-schema"
          ? `<span class="muted">a bare</span> <code>ref</code>`
          : b === "onyx-union-schema"
          ? `<span class="muted">nested</span> <code>anyOf</code>`
          : "";
        return `<a class="variant-card" href="/schema/${b}"><div class="vc-name">${b}.json</div><div class="vc-kinds">${tag}</div></a>`;
      })
      .join("");
    main = `<div class="variants">${cards}</div>`;
  } else if (schema.type === "map" && schema.properties) {
    lead = `<p class="lead">Root kind: ${kindBadge("map")} <span class="muted">· ${schema.values ? "map" : "closed struct"}, ${Object.keys(schema.properties).length} fields</span>${
      govKinds ? ` · governs ${govKinds.map(kindBadge).join(" ")}` : ""
    }</p>`;
    const req = new Set(schema.required || []);
    const rows = Object.entries(schema.properties)
      .map(([k, v]) => {
        const required = req.has(k)
          ? `<span class="req" title="required">required</span>`
          : `<span class="opt">optional</span>`;
        return `<tr><td class="fname">${esc(k)}</td><td>${summarize(v)}</td><td class="freq">${required}</td></tr>`;
      })
      .join("");
    main = `<table class="fields"><thead><tr><th>field</th><th>type</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    lead = `<p class="lead">Root kind: ${kindBadge(schema.type || "any")}</p>`;
    main = schema.type === "map" && schema.values ? `<p class="shape">Open map — every value: ${summarize(schema.values)}</p>` : "";
  }

  const chip = (n) => `<a class="chip" href="/schema/${n}">${n}</a>`;
  const refsOut = outRefs.length ? `<div class="reflist"><span class="muted">references</span> ${outRefs.map(chip).join(" ")}${selfRef ? ` <span class="chip self">↻ itself</span>` : ""}</div>` : selfRef ? `<div class="reflist"><span class="muted">references</span> <span class="chip self">↻ itself</span></div>` : "";
  const refsIn = inRefs.length ? `<div class="reflist"><span class="muted">referenced by</span> ${inRefs.map(chip).join(" ")}</div>` : "";

  const metaNote = isMeta
    ? `<div class="callout">This is the <strong>meta-schema</strong> — the discriminated union that describes what every Onyx schema is, <em>including itself</em>. It validates against its own <code>union</code> variant, whose <code>anyOf</code> items validate against its <code>include</code> variant. The loop closes. See <a href="/doc/references">the fixpoint discussion</a>.</div>`
    : isVariant(file)
    ? `<div class="callout variant-note">A <strong>variant</strong> of the <a href="/schema/onyx-schema">meta-schema union</a> — one of the shapes a schema is allowed to take.</div>`
    : "";

  const body = `
    <div class="crumb"><a href="/">Onyx</a> / <a href="#" class="muted">schemas</a> / ${name}</div>
    <h1><code class="filename">${file}</code></h1>
    <p class="hm-url"><span class="muted">published at</span> <code>${fileToUrl(file)}</code></p>
    ${lead}
    ${metaNote}
    ${main}
    ${refsOut}${refsIn}
    <h2>Source <span class="muted">(dag-json — <code>ref</code> values are links)</span></h2>
    <pre class="json">${highlightJson(schema)}</pre>
  `;
  return { title: file, section: "schema", slug: name, body };
}

// ---------------------------------------------------------------------------
// Startup validation (live badge)
// ---------------------------------------------------------------------------

let VALIDATION = { ok: false, lines: [] };
try {
  const out = execFileSync("node", ["validate.mjs"], { cwd: DIR, encoding: "utf8" });
  const lines = out.trim().split("\n").map((l) => l.trim());
  VALIDATION = { ok: !lines.some((l) => l.startsWith("FAIL")), lines };
} catch (e) {
  VALIDATION = { ok: false, lines: String(e.stdout || e.message).trim().split("\n") };
}

// ---------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------

function sidebar(active) {
  const docLinks = TOUR.map((d, i) => {
    const on = active.section === "doc" && active.slug === d.slug ? " on" : "";
    return `<a class="nav-item${on}" href="/doc/${d.slug}"><span class="num">${i + 1}</span>${esc(d.title)}</a>`;
  }).join("");
  const schemaLink = (f) => {
    const s = base(f);
    const on = active.section === "schema" && active.slug === s ? " on" : "";
    const tag = s === "onyx-schema" ? ` <span class="tag">union</span>` : "";
    const indent = isVariant(f) ? " sub" : "";
    return `<a class="nav-item${on}${indent}" href="/schema/${s}"><code>${f}</code>${tag}</a>`;
  };
  // Meta-schema (union root + variants), the primitive library, then examples.
  const metaLinks = META_FILES.filter((f) => SCHEMA_FILES.includes(f)).map(schemaLink).join("");
  const primitiveLinks = PRIMITIVE_FILES.map(schemaLink).join("");
  const exampleLinks = SCHEMA_FILES.filter((f) => !META_FILES.includes(f) && !isPrimitive(f)).map(schemaLink).join("");
  const homeOn = active.section === "home" ? " on" : "";
  return `<nav class="side">
    <a class="brand" href="/">Onyx<span class="gem">◆</span></a>
    <a class="nav-item${homeOn}" href="/">Overview</a>
    <div class="nav-group">The tour</div>${docLinks}
    <div class="nav-group">Meta-schema</div>${metaLinks}
    <div class="nav-group">Primitives</div>${primitiveLinks}
    <div class="nav-group">Examples</div>${exampleLinks}
    <div class="side-foot">${VALIDATION.ok ? '<span class="ok-dot"></span> self-validates' : '<span class="bad-dot"></span> validation failed'}</div>
  </nav>`;
}

function page(active, contentHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(active.title || "Onyx")}</title>
<style>${CSS}</style></head>
<body>${sidebar(active)}<main><div class="wrap">${contentHtml}</div></main></body></html>`;
}

function docPage(slug) {
  const idx = TOUR.findIndex((d) => d.slug === slug);
  if (idx === -1) return null;
  const d = TOUR[idx];
  const html = mdToHtml(loadText(d.file));
  const prev = idx > 0 ? TOUR[idx - 1] : null;
  const next = idx < TOUR.length - 1 ? TOUR[idx + 1] : null;
  const nav = `<div class="pager">
    ${prev ? `<a class="pg prev" href="/doc/${prev.slug}"><span>← previous</span>${esc(prev.title)}</a>` : `<a class="pg prev" href="/"><span>← back</span>Overview</a>`}
    ${next ? `<a class="pg next" href="/doc/${next.slug}"><span>next →</span>${esc(next.title)}</a>` : `<a class="pg next" href="/schema/onyx-schema"><span>explore →</span>The meta-schema</a>`}
  </div>`;
  return { title: d.title, body: `<article class="doc">${html}</article>${nav}` };
}

function homePage() {
  const readme = loadText("README.md").replace(/^#\s+.*\n/, ""); // drop leading H1 (hero shows it)
  const checks = VALIDATION.lines
    .filter((l) => l.startsWith("ok") || l.startsWith("FAIL"))
    .map((l) => `<li class="${l.startsWith("ok") ? "pass" : "fail"}">${esc(l.replace(/^ok\s+|^FAIL\s+/, ""))}</li>`)
    .join("");
  const hero = `
    <header class="hero">
      <div class="gem-big">◆</div>
      <h1>Onyx</h1>
      <p class="tag-line">A self-describing type system for content-addressed data.</p>
      <div class="badges">
        <span class="badge ${VALIDATION.ok ? "good" : "bad"}">${VALIDATION.ok ? "✓ onyx-schema.json validates itself" : "✗ validation failed"}</span>
        <span class="badge">${SCHEMA_FILES.length} schemas</span>
        <span class="badge">${KINDS.length} kinds</span>
      </div>
      <a class="cta" href="/doc/${TOUR[0].slug}">Start the tour →</a>
    </header>`;
  const graph = `<section class="graph-wrap"><h2>The schema DAG</h2><p class="muted">Each schema is a block; arrows are <code>ref</code>s that become CIDs on IPFS. Click a node. The meta-schema <code>onyx-schema</code> and its six variants form a <strong>cycle</strong> — the type system referring to itself. <code>example-document</code> links to its own kind too (the <code>self</code> loop).</p><div class="graph-scroll">${graphSvg()}</div></section>`;
  const proof = `<section class="proof"><h2>Live proof</h2><p class="muted">Output of <code>node validate.mjs</code>, run when this server started:</p><ul class="checks">${checks}</ul></section>`;
  const primCells = PRIMITIVE_FILES.map((f) => {
    const k = primitiveKind(f);
    return `<a class="prim-cell" href="/schema/${base(f)}">${kindTag(k)}<span class="prim-file">${f}</span></a>`;
  }).join("");
  const primitives = PRIMITIVE_FILES.length
    ? `<section class="prim-wrap"><h2>Primitives — the standard library</h2><p class="muted">One canonical, referenceable schema per kind. Each is just <code>{ "type": &lt;kind&gt; }</code>; reference it (instead of inlining a type) and its <code>ref</code> becomes a CID. Click any kind badge in the explorer to land here.</p><div class="prim-grid">${primCells}</div></section>`
    : "";
  return { title: "Onyx — a self-describing type system", body: `${hero}${graph}${primitives}${proof}<section class="readme doc">${mdToHtml(readme)}</section>` };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const send = (active, body, code = 200) => {
    res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
    res.end(page(active, body));
  };

  if (p === "/") {
    const h = homePage();
    return send({ section: "home", title: h.title }, h.body);
  }
  let m;
  if ((m = p.match(/^\/doc\/([\w-]+)$/))) {
    const d = docPage(m[1]);
    if (d) return send({ section: "doc", slug: m[1], title: d.title }, d.body);
  }
  if ((m = p.match(/^\/schema\/([\w-]+)$/))) {
    const s = schemaPage(m[1]);
    if (s) return send({ section: "schema", slug: m[1], title: s.title }, s.body);
  }
  send({ section: "home", title: "Not found" }, `<div class="wrap"><h1>404</h1><p><a href="/">Back to Onyx</a></p></div>`, 404);
});

server.listen(PORT, () => {
  console.log(`\n  Onyx tour  ->  http://localhost:${PORT}\n`);
  console.log(`  validator: ${VALIDATION.ok ? "self-validates ✓" : "FAILED ✗"}`);
  console.log(`  schemas:   ${SCHEMA_FILES.join(", ")}\n`);
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = `
:root{
  --bg:#0d0f13; --panel:#141821; --panel2:#1a1f2b; --line:#242b39;
  --ink:#dbe1ea; --dim:#8b93a4; --muted:#6b7385; --accent:#8aa2ff; --accent2:#c9a6ff;
  --kind-null:#8a94a6; --kind-boolean:#e0a15e; --kind-integer:#6ab0f3; --kind-float:#7ed0e0;
  --kind-string:#8bd17c; --kind-bytes:#c99bE6; --kind-list:#e6c86e; --kind-map:#8aa2ff; --kind-link:#f3849b;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex}
code,pre,.kind,.filename{font-family:"SF Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.muted{color:var(--muted)}

/* sidebar */
.side{position:fixed;top:0;left:0;width:260px;height:100vh;overflow-y:auto;background:var(--panel);border-right:1px solid var(--line);padding:22px 16px;display:flex;flex-direction:column;gap:2px}
.brand{font-size:22px;font-weight:700;color:var(--ink);letter-spacing:.5px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.brand:hover{text-decoration:none}
.gem{color:var(--accent2);font-size:14px}
.nav-group{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:16px 8px 6px}
.nav-item{display:flex;align-items:center;gap:9px;padding:6px 10px;border-radius:8px;color:var(--dim);font-size:14px}
.nav-item:hover{background:var(--panel2);color:var(--ink);text-decoration:none}
.nav-item.on{background:var(--panel2);color:var(--ink);box-shadow:inset 2px 0 0 var(--accent)}
.nav-item code{font-size:12.5px}
.num{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;background:var(--panel2);border:1px solid var(--line);border-radius:6px;font-size:11px;color:var(--dim)}
.nav-item.on .num{border-color:var(--accent);color:var(--accent)}
.tag{font-size:10px;background:var(--accent2);color:#1a1030;padding:1px 5px;border-radius:5px;letter-spacing:.05em}
.side-foot{margin-top:auto;padding:12px 8px 4px;font-size:12.5px;color:var(--dim);border-top:1px solid var(--line)}
.ok-dot,.bad-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.ok-dot{background:#5fd67a;box-shadow:0 0 8px #5fd67a88}
.bad-dot{background:#f3849b}

/* main */
main{margin-left:260px;flex:1;min-width:0}
.wrap{max-width:820px;margin:0 auto;padding:44px 40px 120px}

/* hero */
.hero{text-align:center;padding:36px 0 26px;border-bottom:1px solid var(--line);margin-bottom:34px}
.gem-big{font-size:34px;color:var(--accent2);filter:drop-shadow(0 0 14px #c9a6ff66)}
.hero h1{font-size:52px;margin:6px 0 4px;letter-spacing:1px;background:linear-gradient(120deg,#fff,#a8b6ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.tag-line{color:var(--dim);font-size:17px;margin:0 0 20px}
.badges{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:22px}
.badge{font-size:12.5px;padding:5px 12px;border-radius:20px;background:var(--panel2);border:1px solid var(--line);color:var(--dim)}
.badge.good{color:#8be2a1;border-color:#2c6b3f}
.badge.bad{color:#f3849b;border-color:#6b2c3a}
.cta{display:inline-block;padding:11px 22px;background:var(--accent);color:#0b0e18;font-weight:600;border-radius:10px}
.cta:hover{text-decoration:none;filter:brightness(1.08)}

/* graph */
.graph-wrap{margin:30px 0}
.graph-scroll{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px}
svg.graph{display:block;margin:0 auto}
.edge{fill:none;stroke:#3d4557;stroke-width:1.6}
.edge.loop{stroke:var(--accent2);stroke-dasharray:3 3}
.arrowhead{fill:#4a5468}
.loop-label{fill:var(--accent2);font:11px monospace;text-anchor:middle}
.node{fill:var(--panel2);stroke:var(--line);stroke-width:1.4;transition:.15s}
.node.meta{stroke:var(--accent2);fill:#1c1630}
a:hover .node{stroke:var(--accent);fill:#232a3a}
.node-label{fill:var(--ink);font:13px "SF Mono",monospace;text-anchor:middle;dominant-baseline:central}

/* proof */
.proof{margin:34px 0}
.checks{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px}
.checks li{padding:7px 12px;border-radius:8px;background:var(--panel);border:1px solid var(--line);font:13px "SF Mono",monospace}
.checks li.pass::before{content:"✓ ";color:#5fd67a}
.checks li.fail::before{content:"✗ ";color:#f3849b}

/* doc prose */
.doc h1{font-size:32px;margin:.2em 0 .5em;letter-spacing:.3px}
.doc h2{font-size:23px;margin:1.5em 0 .5em;padding-bottom:.25em;border-bottom:1px solid var(--line)}
.doc h3{font-size:18px;margin:1.4em 0 .4em;color:#eef1f6}
.doc p{margin:.7em 0}
.doc ul,.doc ol{margin:.6em 0;padding-left:1.4em}
.doc li{margin:.32em 0}
.doc strong{color:#fff}
.doc a code{color:var(--accent)}
hr{border:none;border-top:1px solid var(--line);margin:1.8em 0}
code{background:var(--panel2);border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12.5px;color:#e4b7ff}
pre.code{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;overflow-x:auto;margin:1.1em 0}
pre.code code{background:none;border:none;padding:0;color:#cdd6e6;font-size:13px;line-height:1.6}
table{width:100%;border-collapse:collapse;margin:1.1em 0;font-size:14px;display:block;overflow-x:auto}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
thead th{color:var(--dim);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--line)}
tbody tr:hover{background:var(--panel)}

/* schema page */
.crumb{font-size:13px;color:var(--muted);margin-bottom:8px}
.filename{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:2px 10px;color:#e4b7ff;font-size:.7em}
.lead{color:var(--dim);margin-top:-.2em}
.hm-url{margin:-.3em 0 .6em}
.hm-url code{color:#8fd9c0;background:#12201c;border-color:#204238;font-size:12.5px}
.callout{background:#1a1630;border:1px solid #3a2f5a;border-left:3px solid var(--accent2);border-radius:10px;padding:12px 16px;margin:16px 0;font-size:14px}
.shape{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
table.fields td.fname{font-family:"SF Mono",monospace;color:#9ecbff;font-size:13px;white-space:nowrap}
table.fields td.freq{text-align:right;white-space:nowrap}
.req{font-size:11px;color:#e0a15e}
.opt{font-size:11px;color:var(--muted)}
.kind{display:inline-block;padding:1px 9px;border-radius:20px;font-size:12px;font-weight:600;background:#ffffff0d}
.kind-null{color:var(--kind-null)}.kind-boolean{color:var(--kind-boolean)}.kind-integer{color:var(--kind-integer)}
.kind-float{color:var(--kind-float)}.kind-string{color:var(--kind-string)}.kind-bytes{color:var(--kind-bytes)}
.kind-list{color:var(--kind-list)}.kind-map{color:var(--kind-map)}.kind-link{color:var(--kind-link)}
.kind-union{color:var(--accent2)}
.kind-link:hover{text-decoration:none}
.kind-link:hover .kind{outline:1px solid currentColor;outline-offset:1px}
.variants{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:18px 0}
.variant-card{display:block;padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:12px}
.variant-card:hover{text-decoration:none;border-color:var(--accent);background:var(--panel2)}
.vc-name{font-family:"SF Mono",monospace;font-size:13px;color:#e4b7ff;margin-bottom:8px}
.vc-kinds{display:flex;flex-wrap:wrap;gap:5px}
.variant-note{background:var(--panel);border-color:var(--line);border-left-color:var(--accent)}
.nav-item.sub{padding-left:22px;font-size:13px;opacity:.92}
.nav-item.sub code{font-size:12px}
.prim-body{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 18px;margin:16px 0}
.prim-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:18px 0}
.prim-cell{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:10px}
.prim-cell:hover{text-decoration:none;border-color:var(--accent);background:var(--panel2)}
.prim-file{font-family:"SF Mono",monospace;font-size:11.5px;color:var(--muted)}
.chip{display:inline-block;padding:2px 10px;border-radius:20px;font-size:12.5px;background:var(--panel2);border:1px solid var(--line);color:var(--dim)}
.chip:hover{text-decoration:none;border-color:var(--accent);color:var(--ink)}
.chip.include{color:#8bd17c;border-color:#2f5a34}
.chip.link-chip{color:#f3849b;border-color:#6b2c3a}
.chip.self{color:var(--accent2);border-color:#3a2f5a}
.reflist{margin:12px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* highlighted json */
pre.json{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;overflow-x:auto;font-size:13px;line-height:1.65;white-space:pre}
.j-key{color:#9ecbff}.j-str{color:#8bd17c}.j-num{color:#e0a15e}.j-bool{color:var(--kind-boolean)}
.j-null{color:var(--kind-null)}.j-punct{color:var(--muted)}
.j-ref{color:#f3849b;text-decoration:underline;text-decoration-color:#f3849b66}

/* pager */
.pager{display:flex;gap:14px;margin-top:44px;padding-top:24px;border-top:1px solid var(--line)}
.pg{flex:1;padding:14px 18px;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--ink);display:flex;flex-direction:column;gap:3px}
.pg:hover{text-decoration:none;border-color:var(--accent);background:var(--panel2)}
.pg span{font-size:12px;color:var(--muted)}
.pg.next{text-align:right;align-items:flex-end}

@media(max-width:860px){
  .side{position:static;width:100%;height:auto;border-right:none;border-bottom:1px solid var(--line);flex-direction:row;flex-wrap:wrap;gap:4px}
  body{flex-direction:column}
  main{margin-left:0}
  .nav-group{width:100%}
  .wrap{padding:28px 18px 80px}
}
`;
