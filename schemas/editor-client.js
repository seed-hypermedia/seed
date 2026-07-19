// Onyx editor — a schema-driven data editor that runs in the browser.
//
// It is fed the whole schema set via `window.ONYX_DATA` (see /onyx-data.js) and
// mounts on any <div id="onyx-editor" data-schema="<slug>">. It renders a form
// from the schema, live-validates the value with a browser port of the SAME
// engine as validate.mjs (so the tour's editor and the reference validator can
// never disagree), and shows the resulting dag-json.
//
// Pointed at a normal schema it edits DATA; pointed at onyx-schema (the
// meta-schema) it edits A SCHEMA. One engine, every editor.
(function () {
  "use strict";
  const DATA = window.ONYX_DATA || { schemas: {}, authority: [], manifest: {} };
  const SCHEMAS = DATA.schemas;
  const AUTHORITY = DATA.authority;

  // ---- validator core (ported verbatim from validate.mjs) -----------------

  const urlToFile = (ref) => {
    const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref);
    if (!m) return ref.endsWith(".json") ? ref : `${ref}.json`;
    const prefix = AUTHORITY.find(([, a]) => a === m[1]);
    return prefix ? `${prefix[0]}${m[2]}.json` : `${m[2]}.json`;
  };
  const load = (ref) => SCHEMAS[urlToFile(ref)];

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
    return typeof d;
  }
  const KIND_URL = /^hm:\/\/hyper\.media\/([a-z]+)$/;
  const kindOf = (t) => (typeof t === "string" ? (KIND_URL.exec(t)?.[1] ?? t) : t);

  function typeMatches(type, d) {
    switch (type) {
      case "null": return d === null;
      case "boolean": return typeof d === "boolean";
      case "integer": return typeof d === "number" && Number.isInteger(d);
      case "float": return typeof d === "number";
      case "string": return typeof d === "string";
      case "bytes": return isBytes(d);
      case "list": return Array.isArray(d);
      case "map": return typeOf(d) === "map";
      case "link": return isLink(d);
      default: return false;
    }
  }

  const REFINE = ["properties", "required", "values", "items", "enum"];
  function mergeExtend(parent, ext) {
    const merged = { type: parent.type };
    const props = { ...(parent.properties || {}), ...(ext.properties || {}) };
    if (Object.keys(props).length) merged.properties = props;
    const req = [...new Set([...(parent.required || []), ...(ext.required || [])])];
    if (req.length) merged.required = req;
    const values = ext.values ?? parent.values;
    if (values) merged.values = values;
    const items = ext.items ?? parent.items;
    if (items) merged.items = items;
    const en = ext.enum ?? parent.enum;
    if (en) merged.enum = en;
    return merged;
  }

  function resolveSchema(schema, env = {}) {
    if (!schema || typeof schema !== "object") return { schema: schema || {}, env };
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
    if (schema.ref && schema.type === undefined && schema.anyOf === undefined) {
      const target = load(schema.ref);
      if (!target) return { schema: { __missing: schema.ref }, env };
      if (schema.args) {
        const argsEnv = {};
        for (const [k, v] of Object.entries(schema.args)) argsEnv[k] = v && v.var !== undefined ? env[v.var] : v;
        return resolveSchema(target, argsEnv);
      }
      const parent = resolveSchema(target, env);
      if (REFINE.some((k) => schema[k] !== undefined)) {
        if (parent.schema.anyOf || parent.schema.__unbound) return parent;
        return { schema: mergeExtend(parent.schema, schema), env: parent.env };
      }
      return parent;
    }
    return { schema, env };
  }

  const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function validate(schema0, data, path = "$", env0 = {}) {
    const { schema, env } = resolveSchema(schema0, env0);
    if (schema.__unbound) return [`${path}: unbound type variable "${schema.__unbound}"`];
    if (schema.__missing) return [`${path}: cannot resolve ${schema.__missing}`];
    if (schema.anyOf) {
      const attempts = schema.anyOf.map((v) => validate(v, data, path, env));
      if (attempts.some((e) => e.length === 0)) return [];
      const topLevel = (errs) => errs.some((e) => e.startsWith(`${path}: expected`));
      const best = attempts.slice().sort((a, b) => topLevel(a) - topLevel(b) || a.length - b.length)[0];
      return [`${path}: matches none of the ${schema.anyOf.length} variants`, ...best];
    }
    const errors = [];
    if (schema.enum && !schema.enum.some((v) => deepEqual(v, data)))
      errors.push(`${path}: ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
    const kind = schema.type ? kindOf(schema.type) : null;
    if (kind && !typeMatches(kind, data)) {
      errors.push(`${path}: expected ${kind}, got ${typeOf(data)}`);
      return errors;
    }
    if (kind === "map") {
      for (const key of schema.required ?? []) if (!(key in data)) errors.push(`${path}: missing required "${key}"`);
      const closed = schema.properties && !schema.values;
      for (const [key, value] of Object.entries(data)) {
        const child = schema.properties?.[key] ?? schema.values;
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
        if (re && !re.test(data)) errors.push(`${path}: does not match pattern`);
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

  // ---- default-value synthesis (a valid-ish starting point) ---------------

  function seed(schema0, env = {}) {
    const { schema, env: e } = resolveSchema(schema0, env);
    if (schema.anyOf) return seed(schema.anyOf[0], e);
    if (schema.enum) return schema.enum[0];
    const kind = schema.type ? kindOf(schema.type) : null;
    switch (kind) {
      case "map": {
        const o = {};
        for (const k of schema.required ?? []) o[k] = seed(schema.properties?.[k] ?? {}, e);
        return o;
      }
      case "list": return [];
      case "string": return "";
      case "integer": case "float": return 0;
      case "boolean": return false;
      case "null": return null;
      case "link": return { "/": "" };
      case "bytes": return { "/": { bytes: "" } };
      default: return null;
    }
  }

  // ---- DOM helpers --------------------------------------------------------

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function variantLabel(v) {
    if (v.var !== undefined) return "⟨" + v.var + "⟩";
    if (v.anyOf) return "one of " + v.anyOf.length;
    if (v.ref && v.type === undefined) {
      const t = load(v.ref);
      const kinds = t?.properties?.type?.enum;
      if (kinds) return kinds.map((u) => kindOf(u)).join(" · ");
      const b = urlToFile(v.ref).replace(/\.json$/, "");
      const structural = t ? Object.keys(t).filter((k) => k !== "name" && k !== "description") : [];
      if (t && structural.length === 1 && structural[0] === "type") return kindOf(t.type);
      return b + (v.args ? "⟨…⟩" : "");
    }
    const k = kindOf(v.type);
    if (v.enum) return (k ? k + " " : "") + "enum";
    return k || "any";
  }

  // Pick the union arm that currently fits `value` (else the first arm).
  function matchVariant(anyOf, value, env) {
    for (let i = 0; i < anyOf.length; i++)
      if (validate(anyOf[i], value, "$", env).length === 0) return i;
    return 0;
  }

  // ---- the recursive form builder -----------------------------------------
  // buildNode(schema, value, onChange, env, depth) -> { el, getValue }
  // Recursive schemas (the meta-schema, onyx-any) are infinitely deep, so we
  // expand lazily: optional fields build only when included, and a depth cap
  // falls back to a raw-json box — the form never tries to draw an infinite tree.
  const MAX_DEPTH = 14;

  function buildNode(schema0, value, onChange, env = {}, depth = 0) {
    const { schema, env: e } = resolveSchema(schema0, env);

    if (schema.__unbound || schema.__missing)
      return jsonFallback(value, onChange, schema.__missing ? "unresolved ref" : "unbound type var");
    if (depth > MAX_DEPTH) return jsonFallback(value, onChange, "deeply nested");

    // union — variant picker + sub-form
    if (schema.anyOf) {
      const wrap = el("div", "on-union");
      const sel = el("select", "on-select");
      schema.anyOf.forEach((v, i) => {
        const opt = el("option", null, variantLabel(v));
        opt.value = String(i);
        sel.appendChild(opt);
      });
      let idx = matchVariant(schema.anyOf, value, e);
      sel.value = String(idx);
      const slot = el("div", "on-union-slot");
      let child = null;
      const mount = (v) => {
        slot.innerHTML = "";
        child = buildNode(schema.anyOf[idx], v, onChange, e, depth + 1);
        slot.appendChild(child.el);
      };
      mount(value);
      sel.addEventListener("change", () => {
        idx = Number(sel.value);
        mount(seed(schema.anyOf[idx], e));
        onChange();
      });
      wrap.appendChild(sel);
      wrap.appendChild(slot);
      return { el: wrap, getValue: () => child.getValue() };
    }

    // enum — a plain select over literal values
    if (schema.enum) {
      const sel = el("select", "on-select");
      schema.enum.forEach((v) => {
        const opt = el("option", null, JSON.stringify(v));
        opt.value = JSON.stringify(v);
        sel.appendChild(opt);
      });
      if (value !== undefined) sel.value = JSON.stringify(value);
      sel.addEventListener("change", onChange);
      return { el: sel, getValue: () => JSON.parse(sel.value) };
    }

    const kind = schema.type ? kindOf(schema.type) : null;

    if (kind === "map") return buildMap(schema, value, onChange, e, depth);
    if (kind === "list") return buildList(schema, value, onChange, e, depth);
    if (kind === "boolean") {
      const box = el("input");
      box.type = "checkbox";
      box.checked = value === true;
      box.className = "on-check";
      box.addEventListener("change", onChange);
      const w = el("label", "on-bool");
      w.appendChild(box);
      w.appendChild(el("span", "on-bool-txt", "true"));
      return { el: w, getValue: () => box.checked };
    }
    if (kind === "null") {
      const w = el("span", "on-null", "null");
      return { el: w, getValue: () => null };
    }
    if (kind === "link") return buildWrapped(value, onChange, "link", "CID", "→ dag-json { \"/\": cid }");
    if (kind === "bytes") return buildWrapped(value, onChange, "bytes", "base64", "→ { \"/\": { bytes } }");
    if (kind === "string" || kind === "integer" || kind === "float") {
      const inp = el("input", "on-input");
      inp.type = kind === "string" ? "text" : "number";
      if (kind === "integer") inp.step = "1";
      if (kind === "float") inp.step = "any";
      if (value !== undefined && value !== null) inp.value = value;
      inp.addEventListener("input", onChange);
      const get = () => {
        if (kind === "string") return inp.value;
        if (inp.value.trim() === "") return 0;
        const n = Number(inp.value);
        return Number.isNaN(n) ? inp.value : n;
      };
      return { el: inp, getValue: get };
    }

    // no kind / onyx-any leaf → raw JSON
    return jsonFallback(value, onChange, "any");
  }

  // link / bytes: a single text input wrapped into its dag-json envelope
  function buildWrapped(value, onChange, cls, ph, hint) {
    const cur = cls === "link" ? value?.["/"] ?? "" : value?.["/"]?.bytes ?? "";
    const wrap = el("div", "on-wrapped");
    const inp = el("input", "on-input");
    inp.type = "text";
    inp.placeholder = ph;
    inp.value = typeof cur === "string" ? cur : "";
    inp.addEventListener("input", onChange);
    const tag = el("span", "on-envelope " + cls, hint);
    wrap.appendChild(inp);
    wrap.appendChild(tag);
    return {
      el: wrap,
      getValue: () => (cls === "link" ? { "/": inp.value } : { "/": { bytes: inp.value } }),
    };
  }

  function jsonFallback(value, onChange, note) {
    const wrap = el("div", "on-json-fallback");
    const ta = el("textarea", "on-textarea");
    ta.value = value === undefined ? "null" : JSON.stringify(value, null, 2);
    ta.rows = Math.min(10, ta.value.split("\n").length + 1);
    let last = value === undefined ? null : value;
    ta.addEventListener("input", () => {
      try { last = JSON.parse(ta.value); ta.classList.remove("bad"); }
      catch { ta.classList.add("bad"); }
      onChange();
    });
    wrap.appendChild(el("div", "on-hint", "free-form " + note + " · raw dag-json"));
    wrap.appendChild(ta);
    return { el: wrap, getValue: () => last };
  }

  function buildMap(schema, value, onChange, env, depth = 0) {
    const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const openValues = schema.values || null;
    const wrap = el("div", "on-map");
    const rows = []; // { key, node:()=>node|null, included:()=>bool }

    // declared properties. Required fields build eagerly; optional fields build
    // LAZILY on include — this is what keeps recursive schemas finite.
    for (const [k, sub] of Object.entries(props)) {
      const has = k in v;
      const req = required.has(k);
      const row = el("div", "on-field");
      const head = el("div", "on-field-head");
      const body = el("div", "on-field-body");
      let node = null;
      const build = (val) => { body.innerHTML = ""; node = buildNode(sub, val, onChange, env, depth + 1); body.appendChild(node.el); };
      let toggle = null;
      if (req) {
        build(has ? v[k] : seed(sub, env));
      } else {
        toggle = el("input");
        toggle.type = "checkbox";
        toggle.className = "on-include";
        toggle.checked = has;
        toggle.title = "include this optional field";
        if (has) build(v[k]); else body.style.display = "none";
        toggle.addEventListener("change", () => {
          if (toggle.checked) { if (!node) build(seed(sub, env)); body.style.display = ""; }
          else { body.style.display = "none"; }
          onChange();
        });
        head.appendChild(toggle);
      }
      head.appendChild(el("span", "on-key", k));
      head.appendChild(el("span", req ? "on-req" : "on-opt", req ? "required" : "optional"));
      row.appendChild(head);
      row.appendChild(body);
      wrap.appendChild(row);
      rows.push({ key: k, node: () => node, included: () => (toggle ? toggle.checked : true) });
    }

    // open map: dynamic extra entries validated by `values`
    let extras = [];
    if (openValues) {
      const known = new Set(Object.keys(props));
      const extraWrap = el("div", "on-extras");
      const addExtra = (key, val) => {
        const row = el("div", "on-entry");
        const keyInp = el("input", "on-input on-keyinput");
        keyInp.placeholder = "key";
        keyInp.value = key || "";
        keyInp.addEventListener("input", onChange);
        const node = buildNode(openValues, val === undefined ? seed(openValues, env) : val, onChange, env, depth + 1);
        const rm = el("button", "on-btn on-rm", "✕");
        rm.type = "button";
        const rec = { keyInp, node, row };
        rm.addEventListener("click", () => { extraWrap.removeChild(row); extras = extras.filter((x) => x !== rec); onChange(); });
        row.appendChild(keyInp);
        row.appendChild(node.el);
        row.appendChild(rm);
        extraWrap.appendChild(row);
        extras.push(rec);
      };
      for (const [k, val] of Object.entries(v)) if (!known.has(k)) addExtra(k, val);
      const add = el("button", "on-btn on-add", "+ entry");
      add.type = "button";
      add.addEventListener("click", () => { addExtra("", undefined); onChange(); });
      wrap.appendChild(el("div", "on-open-note", openValues ? "open map — extra keys allowed" : ""));
      wrap.appendChild(extraWrap);
      wrap.appendChild(add);
    }

    return {
      el: wrap,
      getValue: () => {
        const o = {};
        for (const r of rows) { const n = r.node(); if (r.included() && n) o[r.key] = n.getValue(); }
        for (const x of extras) { const k = x.keyInp.value.trim(); if (k) o[k] = x.node.getValue(); }
        return o;
      },
    };
  }

  function buildList(schema, value, onChange, env, depth = 0) {
    const items = Array.isArray(value) ? value : [];
    const sub = schema.items;
    const wrap = el("div", "on-list");
    const holder = el("div", "on-list-items");
    let cells = [];
    const addItem = (val) => {
      const row = el("div", "on-item");
      const idxTag = el("span", "on-idx", "[" + cells.length + "]");
      const node = sub ? buildNode(sub, val, onChange, env, depth + 1) : jsonFallback(val, onChange, "any");
      const rm = el("button", "on-btn on-rm", "✕");
      rm.type = "button";
      const rec = { node, row };
      rm.addEventListener("click", () => { holder.removeChild(row); cells = cells.filter((c) => c !== rec); renumber(); onChange(); });
      row.appendChild(idxTag);
      row.appendChild(node.el);
      row.appendChild(rm);
      holder.appendChild(row);
      cells.push(rec);
    };
    const renumber = () => cells.forEach((c, i) => (c.row.querySelector(".on-idx").textContent = "[" + i + "]"));
    items.forEach(addItem);
    const add = el("button", "on-btn on-add", "+ item");
    add.type = "button";
    add.addEventListener("click", () => { addItem(sub ? seed(sub, env) : null); onChange(); });
    wrap.appendChild(holder);
    wrap.appendChild(add);
    return { el: wrap, getValue: () => cells.map((c) => c.node.getValue()) };
  }

  // ---- JSON preview (light highlight) -------------------------------------

  function highlight(value, indent = 0) {
    const pad = "  ".repeat(indent), pad2 = "  ".repeat(indent + 1);
    if (value === null) return '<span class="j-null">null</span>';
    if (Array.isArray(value)) {
      if (!value.length) return '<span class="j-punct">[]</span>';
      return '<span class="j-punct">[</span>\n' +
        value.map((x) => pad2 + highlight(x, indent + 1)).join('<span class="j-punct">,</span>\n') +
        '\n' + pad + '<span class="j-punct">]</span>';
    }
    if (typeof value === "object") {
      const ks = Object.keys(value);
      if (!ks.length) return '<span class="j-punct">{}</span>';
      return '<span class="j-punct">{</span>\n' +
        ks.map((k) => pad2 + '<span class="j-key">"' + esc(k) + '"</span><span class="j-punct">:</span> ' + highlight(value[k], indent + 1))
          .join('<span class="j-punct">,</span>\n') +
        '\n' + pad + '<span class="j-punct">}</span>';
    }
    if (typeof value === "string") return '<span class="j-str">"' + esc(value) + '"</span>';
    if (typeof value === "boolean") return '<span class="j-bool">' + value + '</span>';
    return '<span class="j-num">' + esc(String(value)) + '</span>';
  }

  // ---- mount --------------------------------------------------------------

  function mount(host) {
    const slug = host.getAttribute("data-schema");
    const schema = SCHEMAS[slug + ".json"];
    if (!schema) { host.textContent = "no schema " + slug; return; }
    const isMeta = slug === "onyx-schema";
    const seedVal = host.hasAttribute("data-seed") ? JSON.parse(host.getAttribute("data-seed")) : seed(schema);

    const grid = el("div", "on-grid");
    const left = el("div", "on-form-col");
    const right = el("div", "on-out-col");
    left.appendChild(el("div", "on-col-title", isMeta ? "Build a schema" : "Build data"));
    right.appendChild(el("div", "on-col-title", "dag-json"));

    const formSlot = el("div", "on-form");
    const status = el("div", "on-status");
    const out = el("pre", "json on-out");

    let root = null;
    const refresh = () => {
      const value = root.getValue();
      const errors = validate(schema, value);
      out.innerHTML = highlight(value);
      if (errors.length === 0) {
        status.className = "on-status ok";
        status.innerHTML = '<span class="on-dot ok"></span> valid ' + (isMeta ? "Onyx schema" : slug);
      } else {
        status.className = "on-status bad";
        status.innerHTML = '<span class="on-dot bad"></span> ' + errors.length + " issue" + (errors.length > 1 ? "s" : "") +
          '<ul class="on-errs">' + errors.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";
      }
    };
    root = buildNode(schema, seedVal, refresh);
    formSlot.appendChild(root.el);
    left.appendChild(formSlot);
    right.appendChild(status);
    right.appendChild(out);

    const bar = el("div", "on-bar");
    const copy = el("button", "on-btn on-copy", "Copy JSON");
    copy.type = "button";
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(JSON.stringify(root.getValue(), null, 2));
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy JSON"), 1200);
    });
    const reset = el("button", "on-btn on-reset", "Reset");
    reset.type = "button";
    reset.addEventListener("click", () => {
      formSlot.innerHTML = "";
      root = buildNode(schema, seed(schema), refresh);
      formSlot.appendChild(root.el);
      refresh();
    });
    bar.appendChild(copy);
    bar.appendChild(reset);
    right.appendChild(bar);

    grid.appendChild(left);
    grid.appendChild(right);
    host.appendChild(grid);
    refresh();
  }

  document.querySelectorAll("#onyx-editor, .onyx-editor").forEach(mount);
})();
