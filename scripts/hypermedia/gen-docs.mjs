// Scaffold a co-located Markdown doc for every Hypermedia schema under hypermedia/ (**/*.schema.json),
// written next to the schema as hypermedia/<name>.md. Each doc describes one
// concept (a type) in prose; the sync step (frontend/apps/cli/src/sync-hypermedia.ts)
// publishes it as hm://<library>/<name> with a `schemaDefinition` metadata field
// linking to that schema's IPFS CID, and the app renders the schema itself
// (shape, references) live in the document's Schema tab. After the first push,
// `sync-hypermedia.ts pull` writes the doc back with block ids, and from then on the
// Seed app is the editor.
//
// The .md files are HAND-AUTHORABLE source: an existing schemas/<name>.md is
// left untouched (the generator only SCAFFOLDS what's missing). Pass --force to
// regenerate every doc from the schema (discards manual edits).
//
//   node scripts/hypermedia/gen-docs.mjs [--force]
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {HM_DIR, listSchemaFiles, nameOfFile, refToName as resolveName} from './names.mjs'
import {join, dirname} from 'node:path'

const FORCE = process.argv.includes('--force')
const BASE = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'
const AUTHORITY = [
  ['hypermedia-', 'hyper.media'],
  ['hypermedia-', 'seed.hyper.media'],
  ['seed-', 'seed.hyper.media'],
  ['example-', 'example.com'],
]
const SRC = HM_DIR
const OUT = HM_DIR

const files = listSchemaFiles()
const schemas = {}
for (const f of files) schemas[nameOfFile(f)] = JSON.parse(readFileSync(join(SRC, f), 'utf8'))

const HYPERMEDIA_UID = BASE.replace('hm://', '')
// The published-doc name is the file's basename.
const publicName = (basename) => basename
const KINDS = ['null', 'boolean', 'integer', 'float', 'string', 'bytes', 'list', 'map', 'struct', 'link']
const KIND_URL = new RegExp(`^hm://(?:hyper\\.media|${HYPERMEDIA_UID})/(?:hypermedia-)?([a-z]+)$`)
const kindOf = (t) => {
  const k = typeof t === 'string' ? KIND_URL.exec(t)?.[1] : undefined
  return k && KINDS.includes(k) ? k : t
}
function refToName(ref) {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref)
  if (!m) return ref.replace(/\.schema\.json$/, '')
  const [, auth, name] = m
  if (auth === HYPERMEDIA_UID) return resolveName(ref, (n) => !!schemas[n])
  const prefix = AUTHORITY.find(([, a]) => a === auth)?.[0]
  return prefix ? `${prefix}${name}` : name
}
const link = (name) => `[${publicName(name)}](${BASE}/${publicName(name)})`

function collectRefs(node, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const s of node) collectRefs(s, acc)
    return acc
  }
  const named = namedSchemaUrl(node)
  if (named) acc.add(refToName(named))
  if (typeof node.target === 'string') acc.add(refToName(node.target))
  for (const [k, v] of Object.entries(node))
    if (k !== 'ref' && k !== 'type' && k !== 'target' && v && typeof v === 'object') collectRefs(v, acc)
  return acc
}
const dependencies = (name) => [...collectRefs(schemas[name])].filter((n) => n !== name && schemas[n]).sort()

/** The schema a node names rather than grounding in a kind (`ref` is the older spelling). */
const namedSchemaUrl = (node) => {
  if (typeof node?.type === 'string') return kindOf(node.type) === node.type ? node.type : null
  return typeof node?.ref === 'string' ? node.ref : null
}
const isPrimitive = (name) => [...KINDS, 'any'].includes(name)
const META_VARIANTS = ['schema/anyof', 'schema/literal-schema', 'schema/property']
const isMeta = (name) =>
  name === 'schema' ||
  META_VARIANTS.includes(name) ||
  (name.startsWith('schema/') && name.endsWith('-schema'))

/** A literal schema: a bare scalar, or {value, description?} with no other schema key. */
const isLiteralSchema = (s) => {
  if (s === undefined) return false
  if (s === null || typeof s !== 'object') return true
  if (Array.isArray(s)) return false
  return 'value' in s && !('type' in s || 'ref' in s || 'anyOf' in s || 'var' in s || 'params' in s)
}
const literalValue = (s) => (s !== null && typeof s === 'object' ? s.value : s)
/** A literal, shown as its value; a kind URL shows as the kind. */
const literalText = (v) => `\`${typeof v === 'string' ? JSON.stringify(kindOf(v)) : String(v)}\``

/** A one-line description of a schema node, with hm:// links for references. */
function summarize(node) {
  if (node === undefined) return 'any'
  if (isLiteralSchema(node)) return literalText(literalValue(node))
  if (node.var !== undefined) return `type variable \`⟨${node.var}⟩\``
  if (node.anyOf) return 'one of ' + node.anyOf.map(summarize).join(' | ')
  const named = namedSchemaUrl(node)
  if (named) {
    const b = refToName(named)
    if (node.args)
      return `${link(b)}⟨${Object.entries(node.args)
        .map(([p, v]) => `${p} = ${summarize(v)}`)
        .join(', ')}⟩`
    return (schemas[b] ? link(b) : `\`${b}\``) + refinements(node)
  }
  const k = kindOf(node.type)
  if (k === 'link')
    return (
      '`link`' +
      (node.target
        ? ` → ${schemas[refToName(node.target)] ? link(refToName(node.target)) : refToName(node.target)}`
        : '')
    )
  if (k === 'list') return `list of ${summarize(node.items)}`
  if (k === 'map') {
    if (node.properties) return `map { ${Object.keys(node.properties).length} fields }`
    if (node.values) return `map ⟨ * : ${summarize(node.values)} ⟩`
    return 'map'
  }
  return (k ? `\`${k}\`` : 'any') + refinements(node)
}

/** Refinements on a leaf: numeric bounds, a semantic format, and the schema a
 * reference is expected to point at (`target`). */
function refinements(node) {
  const bits = []
  if (node.minimum !== undefined || node.maximum !== undefined)
    bits.push(`${node.minimum ?? '…'}–${node.maximum ?? '…'}`)
  if (node.format) bits.push(`format \`${node.format}\``)
  if (node.target) {
    const t = refToName(node.target)
    bits.push(`→ must conform to ${schemas[t] ? link(t) : '`' + node.target + '`'}`)
  }
  return bits.length ? ' (' + bits.join('; ') + ')' : ''
}

function category(name, s) {
  if (name === 'schema') return 'the meta-schema'
  if (isMeta(name)) return 'a meta-schema variant'
  if (isPrimitive(name)) return 'a primitive'
  if (name.startsWith('rpc/'))
    return 'a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob)'
  if (name.startsWith('example/')) return 'an example schema'
  if (name.startsWith('schema/')) return 'a schema-language schema'
  if (!name.includes('/') || /^(block|change|ref|blob|metadata|contact|query)\//.test(name)) return 'a Hypermedia Network blob schema'
  if (false)
    return 'a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob)'
  return 'a schema'
}

/** One bullet per field; a field that is itself a refinement (a nested struct
 * or an extension adding properties — e.g. a typed document's `metadata`) lists
 * its own fields indented beneath it. */
/** A struct's fields: `properties[name] = {value, required?, description?}`. */
function structFields(node) {
  return Object.entries(node.properties || {}).map(([name, entry]) => ({
    name,
    schema: entry?.value === undefined ? {} : entry.value,
    required: entry?.required === true,
    description: entry?.description,
  }))
}
function fieldLines(node, indent = '') {
  const out = []
  for (const f of structFields(node)) {
    const v = f.schema
    out.push(
      `${indent}- \`${f.name}\`${f.required ? ' *(required)*' : ''} — ${summarize(v)}${
        f.description ? ` — ${f.description}` : ''
      }`,
    )
    if (v && typeof v === 'object' && v.properties && !v.anyOf) {
      const base = namedSchemaUrl(v)
      const head = base ? `${indent}  - *adds to ${summarize({type: base})}:*` : null
      if (head) out.push(head)
      out.push(...fieldLines(v, indent + (head ? '    ' : '  ')))
    }
  }
  return out
}

function shapeSection(name, s) {
  const lines = []
  const base = namedSchemaUrl(s)
  const hasExt =
    base &&
    ['properties', 'values', 'items', 'format', 'pattern', 'minimum', 'maximum', 'target'].some(
      (k) => s[k] !== undefined,
    )
  if (s.anyOf) {
    lines.push('A **union** — a value matches one of these variants:\n')
    for (const v of s.anyOf) lines.push(`- ${summarize(v)}`)
  } else if (hasExt) {
    const parent = refToName(base)
    lines.push(`**Extends** ${schemas[parent] ? link(parent) : '`' + parent + '`'} with these added fields:\n`)
    lines.push(...fieldLines(s))
  } else if (base && s.args) {
    const parent = refToName(base)
    lines.push(
      `An **instantiation** of the generic ${schemas[parent] ? link(parent) : '`' + parent + '`'}, binding: ` +
        Object.entries(s.args)
          .map(([p, v]) => `\`${p}\` = ${summarize(v)}`)
          .join(', ') +
        '.',
    )
  } else if (base) {
    const parent = refToName(base)
    lines.push(`An **alias** of ${schemas[parent] ? link(parent) : '`' + parent + '`'}.`)
  } else if ((kindOf(s.type) === 'struct' || kindOf(s.type) === 'map') && s.properties) {
    lines.push(`A ${s.values ? 'map' : '**closed struct**'} with these fields:\n`)
    lines.push(...fieldLines(s))
  } else if (kindOf(s.type) === 'map' && s.values) {
    lines.push(`An **open map** — every value: ${summarize(s.values)}.`)
  } else if (kindOf(s.type) === 'list') {
    lines.push(`A **list** of ${summarize(s.items)}.`)
  } else if (isLiteralSchema(s)) {
    lines.push(`Exactly the value ${literalText(literalValue(s))}.`)
  } else if (s.type) {
    lines.push(`Kind: \`${kindOf(s.type)}\`.`)
  }
  if (s.params)
    lines.push(
      '\n**Generic** over ' +
        Object.entries(s.params)
          .map(([p, d]) => `\`⟨${p}⟩\` (default ${summarize(d)})`)
          .join(', ') +
        '.',
    )
  return lines.join('\n')
}

let count = 0
for (const [name, s] of Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))) {
  const title = s.name || name
  const cat = category(name, s)
  const desc = s.description ? s.description + '\n\n' : ''
  const summary = (s.description || `${title} — ${cat}.`).replace(/\n/g, ' ').slice(0, 160)
  // The schema itself (shape, dependencies) is not repeated in prose: the app
  // renders it live from the document's schemaDefinition in the Schema tab.
  const typeNote = `This document describes the **${name}** type — ${cat}. Its formal schema is attached (the \`schemaDefinition\` in this document's metadata), so the app can show it and create values of this type.\n`
  const md = `---
name: ${JSON.stringify(title)}
summary: ${JSON.stringify(summary)}
---
${desc}${typeNote}`
  const out = join(OUT, `${name}.md`)
  mkdirSync(dirname(out), {recursive: true})
  if (!FORCE && existsSync(out)) continue // never clobber a hand-authored doc
  writeFileSync(out, md)
  count++
}
console.log(`scaffolded ${count} schema doc(s) into ${OUT}/ (${FORCE ? 'forced' : 'skipped existing'})`)
